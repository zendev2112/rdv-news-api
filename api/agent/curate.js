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
async function buildTitleList() {
  const blocks = autoFeedableBlocks()
  const feedIds = feedsForBlocks(blocks)
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
  const feeds = feedIds
    .map((fid) => {
      const items = byFeed.get(fid) || []
      if (!items.length) return null
      const eligible = blocksForFeed(fid, blocks)
      const dest = eligible[0]
      if (!dest) return null
      const section = appConfig.getSection(fid)
      items.sort((a, z) => new Date(z.pubDate || 0) - new Date(a.pubDate || 0))
      return {
        feedId: fid,
        feedName: section?.name || fid,
        front: dest.front,
        blockLabel: dest.label,
        items: items.map((c) => ({
          url: c.url,
          title: c.title,
          image: c.image,
          pubDate: c.pubDate,
        })),
      }
    })
    .filter(Boolean)

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
  if (mode === 'select') {
    try {
      // Lazy imports: keep Claude + Supabase demand out of plain-list cold start.
      const [{ selectCandidates }, { computeDemand }] = await Promise.all([
        import('../../src/services/curation/select.js'),
        import('../../src/services/curation/demand.js'),
      ])
      const list = await buildTitleList()

      // Demand is advisory context for Claude; a failure there shouldn't kill
      // the proposal (it just selects without homepage-need awareness).
      let demand = []
      try {
        demand = await computeDemand()
      } catch (err) {
        console.error('curate select: demand failed:', err.message)
      }

      const { picks, model, error } = await selectCandidates({
        feeds: list.feeds,
        demand,
      })

      const feeds = list.feeds.map((f) => ({
        ...f,
        items: f.items.map((it) => {
          const p = picks.get(it.url)
          return { ...it, pick: p ? { selected: true, ...p } : null }
        }),
      }))

      const candidates = list.feeds.reduce((s, f) => s + f.items.length, 0)
      capture('selection_proposed', {
        tables: feeds.length,
        candidates,
        picked: picks.size,
        model,
        error: error || null,
      })
      await flush()

      return res.status(200).json({
        generatedAt: new Date().toISOString(),
        feeds,
        feedErrors: list.feedErrors,
        stats: list.stats,
        selection: { model, picked: picks.size, candidates, error: error || null },
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
