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
async function generateSocialDraft(url, feedId, cache) {
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

  const fields = await processArticleFromUrl(url, {
    extractedText: postText,
    item: rawItem,
    sourceName,
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

  const rawCache = new Map()
  for (const a of batch) {
    try {
      const social = isSocialMediaUrl(a.url)
      // Social posts can't be scraped — generate from the RSS post text using the
      // same social prompts as the main RSS pipeline. Regular URLs scrape as usual.
      const fields = social
        ? await generateSocialDraft(a.url, a.feedId, rawCache)
        : await processArticleFromUrl(a.url)
      if (!fields) {
        results.push({ url: a.url, front: a.front, status: 'failed', error: 'insufficient-content' })
        continue
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
