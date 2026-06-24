import { pullSupply } from '../../src/services/curation/supply.js'
import { filterDuplicates } from '../../src/services/curation/dedup.js'
import {
  autoFeedableBlocks,
  feedsForBlocks,
} from '../../src/config/homepage-blocks.js'

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN

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
      const { results } = await generateDrafts({ assignments })
      return res.status(200).json({ generatedAt: new Date().toISOString(), results })
    } catch (error) {
      console.error('curate execute error:', error)
      return res.status(500).json({ error: error.message })
    }
  }

  if (mode !== 'list') {
    return res.status(400).json({ error: `unknown mode: ${mode}` })
  }

  // ── List as many fresh RSS titles as possible, grouped by homepage block ──
  try {
    const blocks = autoFeedableBlocks()
    const feedIds = feedsForBlocks(blocks)
    const { candidates, feedErrors } = await pullSupply({ feedIds })

    // In-run dedup by url (a feed can feed several blocks; keep one record each).
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

    const out = blocks
      .map((b) => {
        const items = []
        const urls = new Set()
        for (const f of b.eligibleFeeds) {
          for (const c of byFeed.get(f) || []) {
            if (urls.has(c.url)) continue
            urls.add(c.url)
            items.push({
              url: c.url,
              title: c.title,
              feedId: c.feedId,
              image: c.image,
              pubDate: c.pubDate,
            })
          }
        }
        items.sort((a, z) => new Date(z.pubDate || 0) - new Date(a.pubDate || 0))
        return { front: b.front, label: b.label, items }
      })
      .filter((b) => b.items.length)

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      blocks: out,
      feedErrors,
      stats: {
        feedsPulled: feedIds.length,
        pulled: candidates.length,
        available: unique.length,
      },
    })
  } catch (error) {
    console.error('curate list error:', error)
    return res.status(500).json({ error: error.message })
  }
}
