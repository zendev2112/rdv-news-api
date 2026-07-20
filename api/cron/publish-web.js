// Publish cron — WEB leg. Drains articles the editor ticked `aprobado` to the
// site (Supabase) and enqueues their Redes Sociales row. Additive by design:
// it calls the SAME tested endpoints the "Publicar aprobados" button uses
// (mode:list to find the queue, mode:execute to publish one), so there is no
// duplicated publish logic to drift or regress.
//
// SAFETY: gated by the PostHog `auto-publish` kill switch (fail-safe OFF).
// With the flag off, this runs, finds the queue, and PUBLISHES NOTHING — it
// only logs what it *would* have published. Deploying is therefore inert
// until the editor flips the flag. The editor's `aprobado` tick remains the
// only thing that ever marks a record for publication — this cron never ticks.

import { isAutoPublishEnabled } from '../../src/services/analytics.js'

export const config = { maxDuration: 300 }

const BASE = process.env.SERVER_URL || 'https://rdv-news-api.vercel.app'
const CAP = Math.max(1, Math.min(50, Number(process.env.PUBLISH_WEB_CAP) || 15))

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const admin = process.env.ADMIN_API_TOKEN
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` }

  try {
    // 1. Find every approved-and-still-draft record across the section tables.
    const listRes = await fetch(`${BASE}/api/agent/publish`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ mode: 'list' }),
    })
    const list = await listRes.json().catch(() => ({}))
    if (!listRes.ok) {
      return res.status(502).json({ ok: false, error: `list failed: HTTP ${listRes.status}`, details: list })
    }
    const queue = (list.groups || []).flatMap((g) => g.items || [])
    const batch = queue.slice(0, CAP)

    // 2. Kill switch: dormant unless explicitly enabled.
    const armed = await isAutoPublishEnabled()
    if (!armed) {
      return res.status(200).json({
        ok: true, armed: false, queued: queue.length, wouldPublish: batch.length,
        note: 'auto-publish disabled — nothing published (flip the auto-publish flag to arm)',
        timestamp: new Date().toISOString(),
      })
    }

    // 3. Publish each, oldest queue first, one at a time (the execute endpoint
    //    does Cloudinary + Supabase + social enqueue per record).
    let ok = 0, fail = 0
    const results = []
    for (const it of batch) {
      try {
        const r = await fetch(`${BASE}/api/agent/publish`, {
          method: 'POST', headers: authHeaders,
          body: JSON.stringify({ mode: 'execute', recordId: it.recordId, feedId: it.feedId }),
        })
        const d = await r.json().catch(() => ({}))
        const web = d.result?.web
        if (web?.ok) { ok++; results.push({ recordId: it.recordId, title: it.title, ok: true, social: !!d.result?.social?.ok }) }
        else { fail++; results.push({ recordId: it.recordId, title: it.title, ok: false, error: web?.error || d.error || 'failed' }) }
      } catch (err) {
        fail++
        results.push({ recordId: it.recordId, title: it.title, ok: false, error: err.message })
      }
    }

    return res.status(200).json({
      ok: true, armed: true, queued: queue.length, published: ok, failed: fail,
      remaining: Math.max(0, queue.length - ok), results, timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('publish-web cron error:', error)
    return res.status(500).json({ ok: false, error: error.message })
  }
}
