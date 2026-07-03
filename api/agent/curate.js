import { pullSupply } from '../../src/services/curation/supply.js'
import { filterDuplicates } from '../../src/services/curation/dedup.js'
import appConfig from '../../src/config/index.js'
import {
  autoFeedableBlocks,
  feedsForBlocks,
  blocksForFeed,
} from '../../src/config/homepage-blocks.js'
import { capture, flush } from '../../src/services/analytics.js'

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN

// Vercel ignores builds[].config.maxDuration for functions — it must be declared
// in-file. execute mode runs scrape + 3 Gemini calls per article, so without this
// the function dies at the ~10s default and the client sees a 504.
export const config = { maxDuration: 300 }

// ── Fresh RSS titles, deduped, grouped by source feed (the list-mode shape) ──
// Shared by list mode (manual picking) and select mode (Claude proposes).
// EVERY configured Airtable table gets a group (and thus a slide on the admin):
// block-fed news feeds first, then the remaining tables (recurring/templated —
// clima, quiniela, horóscopo, efemérides — which have no homepage block).
async function buildTitleList() {
  const blocks = autoFeedableBlocks()
  const feedIds = [
    ...new Set([
      ...feedsForBlocks(blocks),
      ...appConfig.sections.map((s) => s.id),
    ]),
  ]
  const { candidates, feedErrors } = await pullSupply({ feedIds })

  // In-run dedup by url.
  const seen = new Set()
  const deduped = []
  for (const c of candidates) {
    if (!c.url || seen.has(c.url)) continue
    seen.add(c.url)
    deduped.push(c)
  }

  // Hide anything already in Supabase or Airtable so the list is only new news.
  const { unique } = await filterDuplicates({ candidates: deduped })

  const byFeed = new Map()
  for (const c of unique) {
    if (!byFeed.has(c.feedId)) byFeed.set(c.feedId, [])
    byFeed.get(c.feedId).push(c)
  }

  // One group per source feed; destination block auto-derived (first eligible).
  // Feeds with no eligible block (recurring tables) keep front=null — their
  // drafts are inserted without homepage placement, like a manual section fetch.
  // Empty feeds stay in the list so every table is visible on the admin.
  const feeds = feedIds.map((fid) => {
    const items = byFeed.get(fid) || []
    const dest = blocksForFeed(fid, blocks)[0] || null
    const section = appConfig.getSection(fid)
    items.sort((a, z) => new Date(z.pubDate || 0) - new Date(a.pubDate || 0))
    return {
      feedId: fid,
      feedName: section?.name || fid,
      front: dest?.front || null,
      blockLabel: dest?.label || null,
      items: items.map((c) => ({
        url: c.url,
        title: c.title,
        image: c.image,
        pubDate: c.pubDate,
      })),
    }
  })

  return {
    feeds,
    feedErrors,
    stats: {
      feedsPulled: feedIds.length,
      pulled: candidates.length,
      available: unique.length,
    },
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const body = typeof req.body === 'object' && req.body ? req.body : {}
  const { mode = 'list' } = body

  // ── Send selected titles to Airtable (reuses the full generation pipeline) ──
  if (mode === 'execute') {
    const assignments = Array.isArray(body.assignments) ? body.assignments : []
    if (!assignments.length) {
      return res.status(400).json({ error: 'no assignments provided' })
    }
    try {
      // Lazy import: keeps the heavy generation pipeline out of list-mode cold start.
      const { generateDrafts } = await import('../../src/services/curation/generate.js')
      const { results, aborted, error: genError } = await generateDrafts({ assignments })
      // Liveness gate tripped (Gemini down) — report 503 so the caller knows the
      // run produced nothing usable, rather than a 200 full of fallback drafts.
      if (aborted) {
        return res.status(503).json({
          generatedAt: new Date().toISOString(),
          error: genError,
          results,
        })
      }
      return res.status(200).json({ generatedAt: new Date().toISOString(), results })
    } catch (error) {
      console.error('curate execute error:', error)
      return res.status(500).json({ error: error.message })
    }
  }

  // ── Day-sheet status board: today's production vs pauta, per table ──────────
  // For each quota'd table: records created today (ART) + the review gate's
  // verdicts parsed from the aiReview field's stable prefix (PUBLISH/HOLD/...).
  if (mode === 'status') {
    try {
      const [{ daySheetFor, startOfDayArtIso, isWeekendArt }, airtableService] =
        await Promise.all([
          import('../../src/config/day-sheet.js'),
          import('../../src/services/airtable.js').then((m) => m.default),
        ])
      const sheet = daySheetFor().filter((r) => r.quota > 0)
      const formula = `IS_AFTER(CREATED_TIME(), '${startOfDayArtIso()}')`

      const rows = []
      const CHUNK = 4 // Airtable: 5 req/s per base
      for (let i = 0; i < sheet.length; i += CHUNK) {
        await Promise.all(
          sheet.slice(i, i + CHUNK).map(async (r) => {
            const section = appConfig.getSection(r.feedId)
            try {
              const records = await airtableService.fetchRecords(r.feedId, {
                filterByFormula: formula,
                maxRecords: 100,
              })
              const verdicts = { publish: 0, hold: 0, reject: 0, pending: 0 }
              for (const rec of records || []) {
                const v = String(rec?.fields?.aiReview || '').split('·')[0].trim().toLowerCase()
                if (v in verdicts) verdicts[v] += 1
                else verdicts.pending += 1
              }
              rows.push({
                feedId: r.feedId,
                feedName: section?.name || r.feedId,
                tier: r.tier,
                quota: r.quota,
                generated: (records || []).length,
                ...verdicts,
              })
            } catch (err) {
              rows.push({
                feedId: r.feedId,
                feedName: section?.name || r.feedId,
                tier: r.tier,
                quota: r.quota,
                error: err.message,
              })
            }
          }),
        )
      }

      // Stable presentation order: locals first, then secondary, then recurring.
      const tierRank = { local: 0, secondary: 1, recurring: 2 }
      rows.sort(
        (a, b) =>
          (tierRank[a.tier] ?? 9) - (tierRank[b.tier] ?? 9) ||
          a.feedName.localeCompare(b.feedName),
      )

      return res.status(200).json({
        generatedAt: new Date().toISOString(),
        weekend: isWeekendArt(),
        rows,
      })
    } catch (error) {
      console.error('curate status error:', error)
      return res.status(500).json({ error: error.message })
    }
  }

  // ── Selection-agreement beacon: the human confirmed a proposal ──────────────
  // Fired once per Send click, before the execute loop. kept/removed/added are
  // measured against Claude's proposal — the raw material of the selection-
  // agreement metric (mirror of review_verdict for the review gate).
  if (mode === 'confirm') {
    const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
    capture('selection_confirmed', {
      proposed: n(body.proposed),
      kept: n(body.kept),
      removed: n(body.removed),
      added: n(body.added),
      sent: n(body.sent),
      model: body.model || null,
    })
    await flush()
    return res.status(200).json({ ok: true })
  }

  // ── Claude proposes a selection over the fresh titles ───────────────────────
  // Demand = the editorial day sheet (quotas per table) minus what was already
  // approved today, NOT homepage-slot vacancy. Repeated sessions are additive.
  if (mode === 'select') {
    try {
      // Lazy imports: keep Claude + Airtable counting out of plain-list cold start.
      const [{ selectCandidates }, { countApprovedToday }, { getSheetRow }] =
        await Promise.all([
          import('../../src/services/curation/select.js'),
          import('../../src/services/curation/approved-today.js'),
          import('../../src/config/day-sheet.js'),
        ])
      const list = await buildTitleList()

      // Count today's records only for tables that have a quota.
      const quotaFeedIds = list.feeds
        .filter((f) => (getSheetRow(f.feedId)?.quota || 0) > 0)
        .map((f) => f.feedId)
      const approved = await countApprovedToday(quotaFeedIds)

      // Attach the day-sheet view to every group (the UI shows it per slide).
      const sheeted = list.feeds.map((f) => {
        const row = getSheetRow(f.feedId)
        const quota = row?.quota || 0
        const approvedToday = approved.get(f.feedId) || 0
        return {
          ...f,
          tier: row?.tier || 'secondary',
          quota,
          approvedToday,
          remaining: Math.max(0, quota - approvedToday),
        }
      })

      // Claude judges local + secondary tables that still owe articles today.
      // Recurring tables get no judgment: today's freshest item(s), auto-picked.
      const proposable = sheeted.filter(
        (f) => f.tier !== 'recurring' && f.remaining > 0 && f.items.length,
      )
      const { picks, model, error } = await selectCandidates({ feeds: proposable })

      let recurringPicked = 0
      const feeds = sheeted.map((f) => {
        if (f.tier === 'recurring') {
          // items arrive newest-first; take what the day still owes.
          const take = new Set(f.items.slice(0, f.remaining).map((it) => it.url))
          recurringPicked += take.size
          return {
            ...f,
            items: f.items.map((it) => ({
              ...it,
              pick: take.has(it.url)
                ? { selected: true, reason: 'ítem del día (recurrente)' }
                : null,
            })),
          }
        }
        return {
          ...f,
          items: f.items.map((it) => {
            const p = picks.get(it.url)
            return { ...it, pick: p ? { selected: true, ...p } : null }
          }),
        }
      })

      // candidates = what Claude actually saw (quota'd news tables).
      const candidates = proposable.reduce((s, f) => s + f.items.length, 0)
      const picked = picks.size + recurringPicked
      capture('selection_proposed', {
        tables: feeds.length,
        candidates,
        picked,
        pickedRecurring: recurringPicked,
        quotaRemaining: sheeted.reduce((s, f) => s + f.remaining, 0),
        model,
        error: error || null,
      })
      await flush()

      return res.status(200).json({
        generatedAt: new Date().toISOString(),
        feeds,
        feedErrors: list.feedErrors,
        stats: list.stats,
        selection: { model, picked, candidates, error: error || null },
      })
    } catch (error) {
      console.error('curate select error:', error)
      return res.status(500).json({ error: error.message })
    }
  }

  if (mode !== 'list') {
    return res.status(400).json({ error: `unknown mode: ${mode}` })
  }

  // ── List fresh RSS titles, grouped by source feed (each headline once) ──
  try {
    const list = await buildTitleList()
    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      ...list,
    })
  } catch (error) {
    console.error('curate list error:', error)
    return res.status(500).json({ error: error.message })
  }
}
