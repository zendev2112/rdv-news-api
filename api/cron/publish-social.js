// Publish cron — REDES leg. Posts to Instagram the Redes Sociales pieces the
// editor approved in the image generator (aprobado ∧ ¬redesPublicado). Calls
// the same tested /airtable-proxy endpoints the "Publicar aprobadas" button
// uses (pending-approved to list, publish-social to post one via Make).
//
// PACED: unlike the web leg, this is capped tight and scheduled a few times a
// day — Instagram allows ~25 API posts/24h and followers punish spammy
// cadence, so it drains slowly on purpose. Gated by the same `auto-publish`
// kill switch (fail-safe OFF): dormant until the editor arms it, publishes
// nothing meanwhile.

import { isAutoPublishEnabled } from '../../src/services/analytics.js'

export const config = { maxDuration: 120 }

const BASE = process.env.SERVER_URL || 'https://rdv-news-api.vercel.app'
const CAP = Math.max(1, Math.min(10, Number(process.env.PUBLISH_SOCIAL_CAP) || 4))

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const key = process.env.CLIENT_API_KEY
  const apiHeaders = { 'Content-Type': 'application/json', 'X-API-Key': key }

  try {
    // 1. Approved-and-unposted social pieces that are DUE (due=1 → respects
    //    publicarEn; the manual button omits it to allow early posting).
    const listRes = await fetch(`${BASE}/api/airtable-proxy/pending-approved?due=1`, { headers: apiHeaders })
    const list = await listRes.json().catch(() => ({}))
    if (!listRes.ok || !list.success) {
      return res.status(502).json({ ok: false, error: `pending-approved failed: HTTP ${listRes.status}`, details: list })
    }
    const queue = list.records || []
    const batch = queue.slice(0, CAP)

    // 2. Kill switch: dormant unless enabled.
    const armed = await isAutoPublishEnabled()
    if (!armed) {
      return res.status(200).json({
        ok: true, armed: false, queued: queue.length, wouldPublish: batch.length,
        note: 'auto-publish disabled — nothing posted (flip the auto-publish flag to arm)',
        timestamp: new Date().toISOString(),
      })
    }

    // 3. Post each (capped) via the same Make webhook path as the button.
    let ok = 0, fail = 0
    const results = []
    for (const it of batch) {
      try {
        const r = await fetch(`${BASE}/api/airtable-proxy/publish-social`, {
          method: 'POST', headers: apiHeaders, body: JSON.stringify({ recordId: it.recordId }),
        })
        const d = await r.json().catch(() => ({}))
        if (r.ok && d.success) { ok++; results.push({ recordId: it.recordId, title: it.title, ok: true }) }
        else { fail++; results.push({ recordId: it.recordId, title: it.title, ok: false, error: d.error || `HTTP ${r.status}` }) }
      } catch (err) {
        fail++
        results.push({ recordId: it.recordId, title: it.title, ok: false, error: err.message })
      }
    }

    return res.status(200).json({
      ok: true, armed: true, queued: queue.length, posted: ok, failed: fail,
      remaining: Math.max(0, queue.length - ok), results, timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('publish-social cron error:', error)
    return res.status(500).json({ ok: false, error: error.message })
  }
}
