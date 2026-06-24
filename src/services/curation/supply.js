import axios from 'axios'
import config from '../../config/index.js'
import {
  SUPPLY_FRESHNESS_HOURS,
  MIN_CONTENT_CHARS,
  blocksForFeed,
} from '../../config/homepage-blocks.js'

const ageHours = (ts) =>
  ts ? Math.round((Date.now() - new Date(ts).getTime()) / 36e5) : null

// rss.app serves JSON Feed (jsonfeed.org). Pull items, don't generate anything.
async function fetchFeedItems(feedId) {
  const section = config.getSection(feedId)
  if (!section || !section.rssUrl) return []
  try {
    const { data } = await axios.get(section.rssUrl, { timeout: 15000 })
    const items = Array.isArray(data?.items) ? data.items : []
    return items.map((it) => {
      const summary = it.content_text || it.summary || ''
      const image = it.image || it.banner_image || ''
      const pubDate = it.date_published || it.date_modified || null
      return {
        feedId,
        url: it.url || it.id || '',
        title: (it.title || '').trim(),
        summary: summary.trim(),
        image,
        pubDate,
        ageHours: ageHours(pubDate),
        contentLength: summary.length,
      }
    })
  } catch (err) {
    return [{ feedId, _feedError: err.message }]
  }
}

/**
 * Pull candidate items for the given feeds (no generation).
 * @returns {Promise<{candidates: Array, feedErrors: Array}>}
 */
export async function pullSupply({ feedIds = [] } = {}) {
  const results = await Promise.all(feedIds.map(fetchFeedItems))
  const flat = results.flat()
  const feedErrors = flat
    .filter((x) => x._feedError)
    .map((x) => ({ feedId: x.feedId, error: x._feedError }))
  const candidates = flat.filter((x) => !x._feedError && x.url)
  return { candidates, feedErrors }
}

/**
 * Deterministic prefilter (no LLM). Drops with a recorded reason:
 *  - no url
 *  - too old (outside freshness window)
 *  - too short (thin content reelaborates badly)
 *  - no image, when every eligible block for that feed requires one
 *  - in-run duplicate url
 */
export function prefilter({ candidates = [] } = {}) {
  const survivors = []
  const skipped = []
  const seen = new Set()

  for (const c of candidates) {
    if (!c.url) {
      skipped.push({ url: c.url, feedId: c.feedId, reason: 'no-url' })
      continue
    }
    if (seen.has(c.url)) {
      skipped.push({ url: c.url, feedId: c.feedId, reason: 'in-run-duplicate' })
      continue
    }
    seen.add(c.url)

    if (c.ageHours != null && c.ageHours > SUPPLY_FRESHNESS_HOURS) {
      skipped.push({ url: c.url, feedId: c.feedId, reason: 'too-old' })
      continue
    }
    if (c.contentLength < MIN_CONTENT_CHARS) {
      skipped.push({ url: c.url, feedId: c.feedId, reason: 'too-short' })
      continue
    }
    // Only block on missing image if NONE of the feed's eligible blocks tolerate it.
    const eligible = blocksForFeed(c.feedId)
    const allNeedImage = eligible.length > 0 && eligible.every((b) => b.requiresImage)
    if (!c.image && allNeedImage) {
      skipped.push({ url: c.url, feedId: c.feedId, reason: 'no-image' })
      continue
    }

    survivors.push(c)
  }

  return { survivors, skipped }
}

/**
 * Keep only the N freshest candidates per feed, so the scoring prompt stays
 * small and focused (blocks usually need ~1 item each). Returns the capped pool
 * plus the count dropped (for transparency).
 */
export function capPerFeed(candidates = [], perFeed = 5) {
  const byFeed = new Map()
  for (const c of candidates) {
    if (!byFeed.has(c.feedId)) byFeed.set(c.feedId, [])
    byFeed.get(c.feedId).push(c)
  }
  const pool = []
  for (const list of byFeed.values()) {
    list.sort((a, b) => (a.ageHours ?? 1e9) - (b.ageHours ?? 1e9))
    pool.push(...list.slice(0, perFeed))
  }
  return { pool, dropped: candidates.length - pool.length }
}
