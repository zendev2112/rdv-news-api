// Markets cron: pull A3 Mercados grain prices → Supabase market_data.
// Scheduled twice per market day (after midday and after pizarra close) —
// the frontend tickers on /agro and the portada read the table directly.

import { fetchMarketData, saveMarketData } from '../../src/services/markets.js'

export const config = { maxDuration: 60 }

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const { rows, errors, empty } = await fetchMarketData()
    const { saved } = await saveMarketData(rows)
    // Loud summary: failures and empty products are visible in the cron log,
    // never silently absorbed.
    return res.status(200).json({
      ok: true,
      saved,
      products: rows.map((r) => `${r.market}:${r.symbol}@${r.price}`),
      empty,
      errors,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('markets cron error:', error)
    return res.status(500).json({ ok: false, error: error.message })
  }
}
