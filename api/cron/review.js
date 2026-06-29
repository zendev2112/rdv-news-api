import axios from 'axios'
import appConfig from '../../src/config/index.js'
import airtableService from '../../src/services/airtable.js'
import {
  autoFeedableBlocks,
  feedsForBlocks,
} from '../../src/config/homepage-blocks.js'
import {
  checkAnthropicHealth,
  submitBatch,
  getBatchResults,
  REVIEW_MODEL,
} from '../../src/services/claude-service.js'
import {
  buildReviewRequest,
  reviewFieldFromResult,
} from '../../src/services/curation/review.js'

// Batch review is async (Claude batches can take minutes). 300s is plenty for the
// submit/retrieve bookkeeping; the batch itself completes between cron ticks.
export const config = { maxDuration: 300 }

const PENDING_PREFIX = 'PENDING ·'
const MAX_PER_RUN = 60 // cap a single run's batch (and bound first-run backlog)
const LOOKBACK_DAYS = 2 // only review recently-created drafts, not the archive

const baseId = appConfig.airtable?.baseId || process.env.AIRTABLE_BASE_ID
const token =
  appConfig.airtable?.personalAccessToken || process.env.AIRTABLE_TOKEN

// Distinct Airtable table names that receive auto-curated drafts.
function autoFeedableTables() {
  const feeds = feedsForBlocks(autoFeedableBlocks())
  const tables = new Set()
  for (const feedId of feeds) {
    const tableName = appConfig.getSection(feedId)?.tableName
    if (tableName) tables.add(tableName)
  }
  return [...tables]
}

// List recent draft records for one table. Returns [] on any per-table error
// (e.g. table lacks a `status` field) so one bad table never sinks the run.
async function listRecentDrafts(tableName) {
  const formula = `AND({status}='draft', IS_AFTER(CREATED_TIME(), DATEADD(NOW(), -${LOOKBACK_DAYS}, 'days')))`
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`
  try {
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      params: { filterByFormula: formula, maxRecords: 100 },
    })
    return (data?.records || []).map((r) => ({
      tableName,
      recordId: r.id,
      fields: r.fields || {},
    }))
  } catch (err) {
    console.error(
      `[cron/review] list failed for "${tableName}":`,
      err.response?.data?.error?.message || err.message,
    )
    return []
  }
}

function parsePendingBatchId(aiReview) {
  // "PENDING · <batchId> · <stamp>"
  const parts = String(aiReview).split(' · ')
  return parts[1] || null
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // Liveness gate — abort loudly if Claude is unreachable instead of silently
  // doing nothing (mirrors the Gemini guard on the generation side).
  const health = await checkAnthropicHealth()
  if (!health.ok) {
    return res
      .status(503)
      .json({ ok: false, error: `claude-unavailable: ${health.error}` })
  }

  const startedAt = new Date().toISOString()

  // ── 1. Scan auto-feedable tables once; partition by review state ──────────
  const tables = autoFeedableTables()
  const scans = await Promise.all(tables.map(listRecentDrafts))
  const drafts = scans.flat()

  const unreviewed = []
  const pending = []
  for (const d of drafts) {
    const v = d.fields.aiReview
    if (!v) unreviewed.push(d)
    else if (String(v).startsWith(PENDING_PREFIX)) pending.push(d)
    // anything else already has a real verdict — skip
  }

  // ── 2. Retrieve: resolve PENDING drafts whose batch has finished ──────────
  const byBatch = new Map()
  for (const d of pending) {
    const bid = parsePendingBatchId(d.fields.aiReview)
    if (!bid) continue
    if (!byBatch.has(bid)) byBatch.set(bid, [])
    byBatch.get(bid).push(d)
  }

  let written = 0
  const retrieveErrors = []
  for (const [batchId, recs] of byBatch) {
    let results
    try {
      results = await getBatchResults(batchId)
    } catch (err) {
      // Not ended yet (404 on results) or transient — leave PENDING for next run.
      retrieveErrors.push({ batchId, error: err.message })
      continue
    }
    const byId = new Map(results.map((r) => [r.custom_id, r]))
    for (const rec of recs) {
      const result = byId.get(rec.recordId)
      if (!result) continue
      const field = reviewFieldFromResult(result, REVIEW_MODEL)
      if (!field) continue // request errored — leave PENDING, will retry
      try {
        await airtableService.updateRecord(
          rec.recordId,
          { aiReview: field },
          rec.tableName,
        )
        written++
      } catch (err) {
        retrieveErrors.push({ recordId: rec.recordId, error: err.message })
      }
    }
  }

  // ── 3. Submit: one batch for unreviewed drafts (capped) ───────────────────
  // CLAIM-FIRST: write a provisional PENDING marker BEFORE submitting, and only
  // batch drafts we could actually write to. A table missing the aiReview field
  // fails the claim and is excluded — so an unwritable draft never reaches the
  // (paid) batch and never triggers the resubmit loop. The marker is patched
  // with the real batch id after submit.
  let submittedBatchId = null
  let submittedCount = 0
  const skippedNoField = []
  const batch = unreviewed.slice(0, MAX_PER_RUN)
  if (batch.length > 0) {
    const provisional = `${PENDING_PREFIX} claiming · ${new Date().toISOString()}`
    const claimable = []
    for (const d of batch) {
      try {
        await airtableService.updateRecord(
          d.recordId,
          { aiReview: provisional },
          d.tableName,
        )
        claimable.push(d)
      } catch (err) {
        skippedNoField.push({ table: d.tableName, recordId: d.recordId })
        console.error(
          `[cron/review] cannot claim ${d.tableName}/${d.recordId} — skipping, not batched (aiReview field missing?): ${err.message}`,
        )
      }
    }

    if (claimable.length > 0) {
      let created
      try {
        created = await submitBatch(
          claimable.map((d) => buildReviewRequest(d.recordId, d.fields)),
        )
      } catch (err) {
        // Revert provisional claims so they retry next run instead of orphaning.
        for (const d of claimable) {
          try {
            await airtableService.updateRecord(d.recordId, { aiReview: '' }, d.tableName)
          } catch {}
        }
        console.error('[cron/review] submitBatch failed:', err.message)
        return res.status(502).json({ ok: false, error: err.message })
      }
      submittedBatchId = created.id
      const marker = `${PENDING_PREFIX} ${created.id} · ${new Date().toISOString()}`
      for (const d of claimable) {
        try {
          await airtableService.updateRecord(d.recordId, { aiReview: marker }, d.tableName)
          submittedCount++
        } catch (err) {
          console.error(`[cron/review] batch-id update failed ${d.recordId}: ${err.message}`)
        }
      }
    }
  }

  return res.status(200).json({
    ok: true,
    startedAt,
    model: REVIEW_MODEL,
    scanned: drafts.length,
    pending: pending.length,
    verdictsWritten: written,
    submittedBatchId,
    submittedCount,
    deferred: Math.max(0, unreviewed.length - batch.length),
    skippedNoField,
    retrieveErrors,
  })
}
