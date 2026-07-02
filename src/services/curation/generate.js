import axios from 'axios'
import {
  processArticleFromUrl,
  isSocialMediaUrl,
  getSocialMediaType,
} from '../article-pipeline.js'
import { extractFromContentHtml } from '../scraper.js'
import airtableService from '../airtable.js'
import { filterDuplicates } from './dedup.js'
import { getBlock } from '../../config/homepage-blocks.js'
import config from '../../config/index.js'
import { checkGeminiHealth } from '../ai-service.js'
import { capture, flush } from '../analytics.js'

// Fetch a feed's raw rss.app items (with content_text/content_html intact, which
// the trimmed supply shape drops). Cached per run so multiple social items from
// the same feed only hit the network once.
async function fetchRawFeedItems(feedId, cache) {
  if (cache.has(feedId)) return cache.get(feedId)
  const section = config.getSection(feedId)
  let items = []
  if (section?.rssUrl) {
    try {
      const { data } = await axios.get(section.rssUrl, { timeout: 15000 })
      items = Array.isArray(data?.items) ? data.items : []
    } catch (err) {
      console.error(`Failed to fetch raw feed ${feedId}: ${err.message}`)
    }
  }
  cache.set(feedId, items)
  return items
}

// Replicates fetch-to-airtable.js processArticle()'s social branch: the post text
// comes from the RSS item (content_text → content_html → summary/title), then the
// SAME shared pipeline reelaborates it with the social prompts (voseo, no emojis,
// no "publicó en Facebook"). Image comes from item.image. The post URL is written
// into its fb-post/ig-post field so the frontend embeds it.
async function generateSocialDraft(url, feedId, cache, diagnostics) {
  const items = await fetchRawFeedItems(feedId, cache)
  const rawItem =
    items.find((it) => (it.url || it.id) === url) ||
    { url, title: '', content_text: '' }

  let postText = rawItem.content_text || ''
  if ((!postText || postText.length < 100) && rawItem.content_html) {
    const htmlText = extractFromContentHtml(rawItem.content_html)
    if (htmlText && htmlText.length > postText.length) postText = htmlText
  }
  if (!postText || postText.length < 50) {
    postText = rawItem.summary || rawItem.title || postText
  }
  if (!postText || postText.length < 50) return null // nothing to reelaborate

  // Source name from the hostname (matches fetch-to-airtable.js).
  let sourceName
  try {
    const domain = new URL(url).hostname.replace(/^www\./, '')
    const first = domain.split('.')[0]
    sourceName = first.charAt(0).toUpperCase() + first.slice(1)
  } catch {
    sourceName = rawItem.authors?.[0]?.name || 'Social Media'
  }

  // The author handle (e.g. "verdirrojo") lets the registry resolve the source
  // even when the post URL is an opaque permalink.
  const sourceHints = [rawItem.authors?.[0]?.name, rawItem.author, url]
    .filter(Boolean)
    .join(' ')

  const fields = await processArticleFromUrl(url, {
    extractedText: postText,
    item: rawItem,
    sourceName,
    feedId,
    sourceHints,
    diagnostics,
  })
  if (!fields) return null

  // Embed the post in its social field (frontend renders the embed).
  const socialType = getSocialMediaType(url)
  if (socialType) fields[socialType] = url

  // Dedicated social-section extras (mirror fetch-to-airtable local-facebook).
  if (feedId === 'local-facebook') {
    fields.processingStatus = 'completed'
    if (rawItem.date_published) {
      fields.postDate = rawItem.date_published
      try {
        fields.postDateFormatted = new Date(
          rawItem.date_published,
        ).toLocaleDateString('es-AR', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      } catch {}
    }
    if (rawItem.content_html) fields.contentHtml = rawItem.content_html
    if (rawItem.id) fields.postId = rawItem.id
  }
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

  // Liveness gate: one cheap Gemini probe before generating anything. If the key
  // is dead or the Generative Language API is disabled, abort the whole run with a
  // clear error instead of silently writing fallback (non-reelaborated) drafts —
  // the failure mode that hid a disabled API in production.
  if (batch.length > 0) {
    const health = await checkGeminiHealth()
    if (!health.ok) {
      for (const a of toGenerate) {
        results.push({
          url: a.url,
          front: a.front,
          status: 'failed',
          error: `gemini-unavailable: ${health.error}`,
        })
      }
      return { results, aborted: true, error: `gemini-unavailable: ${health.error}` }
    }
  }

  const rawCache = new Map()
  for (const a of batch) {
    try {
      const social = isSocialMediaUrl(a.url)
      const diagnostics = {}
      // Social posts can't be scraped — generate from the RSS post text using the
      // same social prompts as the main RSS pipeline. Regular URLs scrape as usual.
      const fields = social
        ? await generateSocialDraft(a.url, a.feedId, rawCache, diagnostics)
        : await processArticleFromUrl(a.url, {
            diagnostics,
            sourceDate: a.pubDate,
            feedId: a.feedId,
          })
      if (!fields) {
        // An otros-medios interview with no reportable fact is skipped by policy
        // (not a failure): no draft, reported as 'skipped' so the count is visible.
        if (diagnostics.skipReason === 'interview-no-fact') {
          results.push({
            url: a.url,
            front: a.front,
            status: 'skipped',
            reason: 'interview-no-fact',
            via: diagnostics.interviewVia,
          })
        } else if (diagnostics.skipReason === 'interview-brief-failed') {
          results.push({ url: a.url, front: a.front, status: 'failed', error: 'interview-brief-failed' })
        } else {
          results.push({ url: a.url, front: a.front, status: 'failed', error: 'insufficient-content' })
        }
        continue
      }
      // Loud failure: a Gemini call errored mid-run (rate limit, timeout, key
      // revoked between probe and now). Refuse to save a silently-degraded draft.
      if (diagnostics.aiError) {
        results.push({ url: a.url, front: a.front, status: 'failed', error: 'generation-failed (gemini error mid-run)' })
        continue
      }
      // The agent's editorial decision, carried to the homepage at publish time.
      fields.front = a.front
      fields.order = 'principal' // newest leads the block (spec principle 4)

      const res = await airtableService.insertRecords([{ fields }], a.feedId)
      const id = res?.records?.[0]?.id || null
      const brief = diagnostics.contentType === 'breve'
      // Analytics: top of the funnel — a draft was generated and written.
      if (id) {
        capture('article_generated', {
          feed: a.feedId,
          front: a.front,
          social,
          brief, // interview down-converted to a fact-brief
          contentType: diagnostics.contentType || 'article',
          interviewVia: diagnostics.interviewVia || null,
          source: fields.source || null,
        })
      }
      results.push(
        id
          ? { url: a.url, front: a.front, status: 'drafted', social, brief, airtableId: id }
          : { url: a.url, front: a.front, status: 'failed', error: 'insert-returned-no-id' },
      )
    } catch (err) {
      results.push({ url: a.url, front: a.front, status: 'failed', error: err.message })
    }
  }

  for (const a of deferred) {
    results.push({ url: a.url, front: a.front, status: 'deferred', reason: 'batch-limit (run again)' })
  }

  // Serverless-safe: flush analytics before the handler/process can freeze.
  await flush()

  return { results }
}
