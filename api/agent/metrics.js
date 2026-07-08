// ── Producción cockpit endpoint ──────────────────────────────────────────────
// Thin auth wrapper over buildProductionMetrics(): the admin's "Producción"
// card POSTs here and gets the last-30-ART-days counts (drafts from Airtable,
// published from Supabase, daily pauta) pre-aggregated for the charts.

import { buildProductionMetrics } from '../../src/services/metrics.js'

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN

// Sweeps ~28 Airtable tables (paginated, 4 at a time) — needs more than the
// ~10s serverless default.
export const config = { maxDuration: 300 }

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
  const windowDays = Math.min(90, Math.max(7, Number(body.windowDays) || 30))

  try {
    const metrics = await buildProductionMetrics({ windowDays })
    return res.status(200).json(metrics)
  } catch (error) {
    console.error('metrics error:', error)
    return res.status(500).json({ error: error.message })
  }
}
