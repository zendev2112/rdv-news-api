import appConfig from '../../src/config/index.js'
import { capture, flush } from '../../src/services/analytics.js'

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN

// Vercel ignores builds[].config.maxDuration for functions — declare in-file.
// execute mode does a Cloudinary upload + Supabase upsert + a social enqueue per
// record; well under 300s for one record, but keep the ceiling high.
export const config = { maxDuration: 300 }

// A record is ready to publish when the editor has ticked `aprobado` AND it is
// still a draft. Once published, status flips out of 'draft' so it drops off the
// list — the query is naturally idempotent. Tables without an `aprobado` field
// make Airtable reject the formula; fetchRecords swallows that and returns [],
// so those tables are simply skipped (add the field where you want the button).
const READY_FORMULA = "AND({aprobado}, {status}='draft')"

// Build the flat social payload the /webhooks/airtable/social-media route expects
// (mirrors the Airtable publish button's socialPayload). The route handles the
// section object/string and attachment shapes, so pass record fields through.
function socialPayloadFromRecord(record, section) {
  const f = record.fields || {}
  return {
    title: f.title || '',
    overline: f.overline || '',
    excerpt: f.excerpt || '',
    article: f.article || '',
    url: f.url || '',
    image: Array.isArray(f.image) ? f.image : [],
    imgUrl: f.imgUrl || '',
    tags: f.tags || '',
    socialMediaText: f.socialMediaText || '',
    // Prefer the record's own section; fall back to the table's display name.
    section: f.section || section?.name || section?.id || '',
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

  const airtableService = (await import('../../src/services/airtable.js')).default

  // ── List approved-and-still-draft records, grouped by table ─────────────────
  if (mode === 'list') {
    try {
      const feedIds = appConfig.sections.map((s) => s.id)
      const groups = []
      const CHUNK = 4 // Airtable: 5 req/s per base
      for (let i = 0; i < feedIds.length; i += CHUNK) {
        await Promise.all(
          feedIds.slice(i, i + CHUNK).map(async (feedId) => {
            const section = appConfig.getSection(feedId)
            const records = await airtableService.fetchRecords(feedId, {
              filterByFormula: READY_FORMULA,
              maxRecords: 100,
            })
            if (!records || !records.length) return
            groups.push({
              feedId,
              feedName: section?.name || feedId,
              count: records.length,
              items: records.map((r) => ({
                recordId: r.id,
                feedId,
                title: r.fields?.title || '(sin título)',
                section: r.fields?.section || '',
                hasImage:
                  !!(r.fields?.imgUrl || (Array.isArray(r.fields?.image) && r.fields.image.length)),
              })),
            })
          }),
        )
      }
      groups.sort((a, b) => a.feedName.localeCompare(b.feedName))
      const total = groups.reduce((n, g) => n + g.count, 0)
      return res.status(200).json({ generatedAt: new Date().toISOString(), groups, total })
    } catch (error) {
      console.error('publish list error:', error)
      return res.status(500).json({ error: error.message })
    }
  }

  // ── Publish ONE approved record end-to-end ──────────────────────────────────
  // One record per request; the admin loops for live per-row progress and to stay
  // clear of gateway timeouts (same pattern as the curate execute loop).
  if (mode === 'execute') {
    const recordId = typeof body.recordId === 'string' ? body.recordId : null
    const feedId = typeof body.feedId === 'string' ? body.feedId : null
    if (!recordId || !feedId) {
      return res.status(400).json({ error: 'recordId and feedId are required' })
    }
    const section = appConfig.getSection(feedId)
    if (!section) {
      return res.status(400).json({ error: `unknown feedId: ${feedId}` })
    }
    const tableName = section.tableName || feedId

    const result = { recordId, feedId, title: '', web: null, social: null }
    let statusFlipped = false
    try {
      const [{ handlePublishStatusChange }, supabaseService] = await Promise.all([
        import('../../src/services/statusChangeHandler.js'),
        import('../../src/services/supabase.js').then((m) => m.default),
      ])

      // 1. Flip status → published. This both satisfies the prepare step's guard
      //    and is the status publishArticle carries to the site. The per-table
      //    Airtable automation may also fire on this change — harmless, since the
      //    prepare step below is idempotent (Cloudinary skips already-uploaded).
      await airtableService.updateRecord(recordId, { status: 'published' }, feedId)
      statusFlipped = true

      // 2. Prepare deterministically in-process: SEO slug + Cloudinary upload.
      await handlePublishStatusChange(recordId, tableName, feedId)

      // 3. Re-fetch with slug + Cloudinary URLs in place, then publish to the site.
      const record = await airtableService.getRecord(recordId, feedId)
      result.title = record?.fields?.title || ''
      const pub = await supabaseService.publishArticle(record)
      if (!pub || !pub.success) {
        throw new Error(pub?.error || 'supabase publishArticle failed')
      }
      result.web = { ok: true, id: pub.data?.id || null, section: pub.data?.section || null }

      // 4. Enqueue the Redes Sociales row (best-effort; being rebuilt separately).
      //    Self-call the existing, tested webhook so this build stays additive.
      try {
        const host = req.headers['x-forwarded-host'] || req.headers.host
        const proto = req.headers['x-forwarded-proto'] || 'https'
        const socialRes = await fetch(`${proto}://${host}/webhooks/airtable/social-media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}` },
          body: JSON.stringify(socialPayloadFromRecord(record, section)),
        })
        const sd = await socialRes.json().catch(() => ({}))
        result.social = socialRes.ok && sd.success
          ? { ok: true }
          : { ok: false, error: sd.error || `HTTP ${socialRes.status}` }
      } catch (socialErr) {
        result.social = { ok: false, error: socialErr.message }
      }

      // 5. Untick so the record leaves the approved-drafts view cleanly.
      try {
        await airtableService.updateRecord(recordId, { aprobado: false }, feedId)
      } catch (_) {
        /* cosmetic — status already excludes it from the list */
      }

      capture('article_published', {
        feedId,
        section: result.web.section,
        social: !!result.social?.ok,
      })
      await flush()
      return res.status(200).json({ generatedAt: new Date().toISOString(), result })
    } catch (error) {
      console.error(`publish execute error (${recordId}):`, error)
      // Roll the status back so a failed record stays retryable in the list.
      if (statusFlipped) {
        try {
          await airtableService.updateRecord(recordId, { status: 'draft' }, feedId)
        } catch (_) {
          /* best-effort rollback */
        }
      }
      result.web = { ok: false, error: error.message }
      capture('article_published', { feedId, error: error.message })
      await flush()
      return res.status(200).json({ generatedAt: new Date().toISOString(), result })
    }
  }

  return res.status(400).json({ error: `unknown mode: ${mode}` })
}
