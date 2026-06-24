import {
  processArticleFromUrl,
  isSocialMediaUrl,
  getSocialMediaType,
  extractSourceName,
} from '../article-pipeline.js'
import airtableService from '../airtable.js'
import { filterDuplicates } from './dedup.js'
import { getBlock } from '../../config/homepage-blocks.js'

// Social posts (Facebook/Instagram/…) can't be scraped, so the article pipeline
// returns null. Mirror the Instituciones/Slack path: save a minimal draft with
// the post URL in its social field instead of failing. The editor finishes it at
// the Airtable review gate.
function buildSocialDraft(url) {
  const sourceName = extractSourceName(url)
  const socialType = getSocialMediaType(url)
  const fields = {
    title: `Publicación de ${sourceName}`,
    source: sourceName,
    article: `Enlace a publicación de ${sourceName}: ${url}`,
    url,
    status: 'draft',
  }
  if (socialType) fields[socialType] = url
  return fields
}

// Each generation scrapes + runs 3 Gemini calls (~10-30s). Vercel maxDuration is
// 300s, so cap how many we generate per request; the rest come back "deferred"
// for the operator to run again.
const EXECUTE_BATCH = 10

/**
 * Generate drafts for approved assignments. Reuses processArticleFromUrl (all
 * prompt layers + voseo enforcement, untouched), injects front + order, and
 * writes to the feed's Airtable table. Sequential to respect rate limits.
 *
 * @param {Object} opts
 * @param {Array}  opts.assignments  [{ url, front, feedId, role? }]
 * @returns {Promise<{results: Array}>}
 */
export async function generateDrafts({ assignments = [] } = {}) {
  const results = []
  if (!assignments.length) return { results }

  // Validate server-side — never trust the client's block/feed pairing.
  const valid = []
  for (const a of assignments) {
    const block = getBlock(a?.front)
    if (!a?.url || !a?.feedId || !block || !block.eligibleFeeds.includes(a.feedId)) {
      results.push({ url: a?.url, front: a?.front, status: 'failed', error: 'invalid-assignment' })
    } else {
      valid.push(a)
    }
  }

  // Just-in-time dedup re-check (a cron may have inserted since the plan ran).
  const { skipped } = await filterDuplicates({ candidates: valid })
  const dupSet = new Set(skipped.map((s) => s.url))

  const toGenerate = []
  for (const a of valid) {
    if (dupSet.has(a.url)) {
      results.push({ url: a.url, front: a.front, status: 'skipped', reason: 'duplicate' })
    } else {
      toGenerate.push(a)
    }
  }

  const batch = toGenerate.slice(0, EXECUTE_BATCH)
  const deferred = toGenerate.slice(EXECUTE_BATCH)

  for (const a of batch) {
    try {
      let fields = await processArticleFromUrl(a.url)
      let social = false
      if (!fields) {
        // Social URL → save as a social draft (like Instituciones). A non-social
        // URL with no extractable content genuinely can't be drafted.
        if (isSocialMediaUrl(a.url)) {
          fields = buildSocialDraft(a.url)
          social = true
        } else {
          results.push({ url: a.url, front: a.front, status: 'failed', error: 'insufficient-content' })
          continue
        }
      }
      // The agent's editorial decision, carried to the homepage at publish time.
      fields.front = a.front
      fields.order = 'principal' // newest leads the block (spec principle 4)

      const res = await airtableService.insertRecords([{ fields }], a.feedId)
      const id = res?.records?.[0]?.id || null
      results.push(
        id
          ? { url: a.url, front: a.front, status: 'drafted', social, airtableId: id }
          : { url: a.url, front: a.front, status: 'failed', error: 'insert-returned-no-id' },
      )
    } catch (err) {
      results.push({ url: a.url, front: a.front, status: 'failed', error: err.message })
    }
  }

  for (const a of deferred) {
    results.push({ url: a.url, front: a.front, status: 'deferred', reason: 'batch-limit (run again)' })
  }

  return { results }
}
