import { createClient } from '@supabase/supabase-js'
import {
  autoFeedableBlocks,
  STALE_HOURS,
} from '../../config/homepage-blocks.js'

// Mirrors api/frontend/coverage.js: same view, same filter, same recency order.
const VIEW = 'article_with_sections'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
)

const ageHours = (ts) =>
  ts ? Math.round((Date.now() - new Date(ts).getTime()) / 36e5) : null

/**
 * Per-block demand. A block is "hungry" if it has empty slots OR its newest
 * slotted article is stale (needs a fresh lead). `need` = empty slots, but a
 * stale-but-full block still gets need=1 so it can rotate.
 *
 * @param {Object}   opts
 * @param {string}   [opts.scope='hungry']  'hungry' = all feedable blocks, or a
 *                                           single `front` value to target one.
 * @returns {Promise<Array>} blocks sorted by hunger (most urgent first)
 */
export async function computeDemand({ scope = 'hungry' } = {}) {
  let blocks = autoFeedableBlocks()
  if (scope && scope !== 'hungry') {
    blocks = blocks.filter((b) => b.front === scope)
  }

  const rows = await Promise.all(
    blocks.map(async (b) => {
      const { count, data, error } = await supabase
        .from(VIEW)
        .select('created_at', { count: 'exact' })
        .eq('front', b.front)
        .eq('status', 'published')
        .order('created_at', { ascending: false })
        .limit(b.slots)

      if (error) {
        return { ...b, error: error.message, hungry: false, need: 0 }
      }

      const pool = count ?? (data ? data.length : 0)
      const filled = Math.min(pool, b.slots)
      const newestAgeHours = ageHours(data && data[0] ? data[0].created_at : null)
      const stale =
        newestAgeHours == null || newestAgeHours > STALE_HOURS
      const emptySlots = b.slots - filled
      const need = emptySlots > 0 ? emptySlots : stale ? 1 : 0

      return {
        front: b.front,
        label: b.label,
        layer: b.layer,
        slots: b.slots,
        filled,
        pool,
        newestAgeHours,
        stale,
        need,
        hungry: need > 0,
        eligibleFeeds: b.eligibleFeeds,
        requiresImage: b.requiresImage,
      }
    }),
  )

  // Most urgent first: empty slots dominate, staleness breaks ties.
  return rows.sort(
    (a, b) =>
      b.need - a.need || (b.newestAgeHours || 0) - (a.newestAgeHours || 0),
  )
}
