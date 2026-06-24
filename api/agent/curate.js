import { computeDemand } from '../../src/services/curation/demand.js'
import { pullSupply, prefilter, capPerFeed } from '../../src/services/curation/supply.js'
import { filterDuplicates } from '../../src/services/curation/dedup.js'
import { scoreAndAssign } from '../../src/services/curation/score.js'
import {
  feedsForBlocks,
  DEFAULT_MAX_PER_RUN,
  CANDIDATES_PER_FEED,
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
  const {
    mode = 'plan',
    scope = 'hungry',
    maxPerRun = DEFAULT_MAX_PER_RUN,
  } = body

  if (mode === 'execute') {
    const assignments = Array.isArray(body.assignments) ? body.assignments : []
    if (!assignments.length) {
      return res.status(400).json({ error: 'no assignments provided' })
    }
    try {
      // Lazy import: keeps the heavy generation pipeline out of plan-mode cold start.
      const { generateDrafts } = await import('../../src/services/curation/generate.js')
      const { results } = await generateDrafts({ assignments })
      return res.status(200).json({ generatedAt: new Date().toISOString(), results })
    } catch (error) {
      console.error('curate execute error:', error)
      return res.status(500).json({ error: error.message })
    }
  }
  if (mode !== 'plan') {
    return res.status(400).json({ error: `unknown mode: ${mode}` })
  }

  try {
    // 1. Demand → which blocks are hungry, which feeds to pull.
    const demand = await computeDemand({ scope })
    const hungry = demand.filter((b) => b.hungry)

    if (!hungry.length) {
      return res.status(200).json({
        generatedAt: new Date().toISOString(),
        mode,
        demand,
        plan: [],
        skipped: [],
        feedErrors: [],
        stats: { hungryBlocks: 0, feedsPulled: 0, candidates: 0, afterPrefilter: 0, afterDedup: 0, assigned: 0 },
        message: 'No hungry blocks — homepage is full and fresh.',
      })
    }

    // 2. Supply → pull RSS items for eligible feeds (no generation).
    const feedIds = feedsForBlocks(hungry)
    const { candidates, feedErrors } = await pullSupply({ feedIds })

    // 3. Prefilter (deterministic) → 4-way dedup (Airtable + Supabase).
    const { survivors, skipped: pfSkipped } = prefilter({ candidates })
    const { unique, skipped: ddSkipped } = await filterDuplicates({ candidates: survivors })

    // Cap to the freshest few per feed so the scoring prompt stays small.
    const { pool, dropped: cappedOut } = capPerFeed(unique, CANDIDATES_PER_FEED)

    // 4. Score + assign (Gemini) on the capped survivor set.
    const { assignments, skipped: scSkipped } = await scoreAndAssign({
      candidates: pool,
      demand: hungry,
      maxPerRun,
    })

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      mode,
      demand,
      plan: assignments,
      skipped: [...pfSkipped, ...ddSkipped, ...scSkipped],
      feedErrors,
      stats: {
        hungryBlocks: hungry.length,
        feedsPulled: feedIds.length,
        candidates: candidates.length,
        afterPrefilter: survivors.length,
        afterDedup: unique.length,
        scored: pool.length,
        cappedOut,
        assigned: assignments.length,
      },
    })
  } catch (error) {
    console.error('curate error:', error)
    return res.status(500).json({ error: error.message })
  }
}
