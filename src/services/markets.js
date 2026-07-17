// ── Mercados agropecuarios: A3 Mercados (ex Matba-Rofex) → Supabase ─────────
//
// Phase 1 of the markets tickers: grain FUTURES and DISPONIBLE (spot) from
// A3's public JSON API (apicem) — primary source, no auth, no HTML scraping.
// Rows land in Supabase `market_data`; the frontend tickers read them with
// the anon client (public-read RLS).
//
// Phase 2 (separate fetchers, same table): pizarra Bahía Blanca
// (bcp.org.ar/cotizaciones/*.asp) and hacienda MAG Cañuelas.
//
// LOUD FAILURE: a product group that fails or comes back empty is reported in
// the summary — the tickers show yesterday's close (labeled) rather than
// silently wrong numbers. Grain prices are reputation with the agro audience.

import supabaseService from './supabase.js'
import logger from '../utils/logger.js'

const A3 = 'https://apicem.matbarofex.com.ar/api/v2'

// Product catalog: what we ask A3 for, and how it labels in the ticker.
// GIR/CEB/SORGO futures are seasonal/illiquid — empty responses are normal
// and simply mean the product sits out the ticker until it trades again.
const FUTURE_PRODUCTS = [
  { a3: 'SOJ Dolar MATba', product: 'soja', positions: 2 },
  { a3: 'MAI Dolar MATba', product: 'maiz', positions: 2 },
  { a3: 'TRI Dolar MATba', product: 'trigo', positions: 2 },
]
const DISPONIBLE_PRODUCTS = [
  { a3: 'SOJ Disponible', product: 'soja' },
  { a3: 'MAI Disponible', product: 'maiz' },
  { a3: 'TRI Disponible', product: 'trigo' },
  { a3: 'SOR Disponible', product: 'sorgo' },
  { a3: 'GIR', product: 'girasol' },
  { a3: 'CEB', product: 'cebada' },
]

async function fetchA3ClosingPrices(product, days = 7) {
  const to = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  const params = new URLSearchParams({ product, from, to })
  const res = await fetch(`${A3}/closing-prices?${params}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`A3 ${product}: HTTP ${res.status}`)
  const data = await res.json()
  return data.data || []
}

// Keep only each symbol's most recent row.
function latestBySymbol(rows) {
  const map = new Map()
  for (const r of rows) {
    const prev = map.get(r.symbol)
    if (!prev || new Date(r.dateTime) > new Date(prev.dateTime)) map.set(r.symbol, r)
  }
  return [...map.values()]
}

// Front positions first: symbols look like "SOJ.ROS/JUL26" — sort by the
// implied maturity date so the nearest positions lead the ticker.
const MONTHS = { ENE: 0, FEB: 1, MAR: 2, ABR: 3, MAY: 4, JUN: 5, JUL: 6, AGO: 7, SEP: 8, SET: 8, OCT: 9, NOV: 10, DIC: 11 }
function maturityOf(symbol) {
  const m = symbol.match(/\/([A-Z]{3})(\d{2})$/)
  if (!m || !(m[1] in MONTHS)) return Number.MAX_SAFE_INTEGER
  return new Date(2000 + Number(m[2]), MONTHS[m[1]], 1).getTime()
}

function toRow({ market, product, r }) {
  const price = Number(r.settlement || r.close)
  if (!price || !isFinite(price)) return null
  return {
    day: String(r.dateTime).slice(0, 10),
    market,
    product,
    symbol: r.symbol,
    price,
    currency: 'USD',
    unit: 'tonelada',
    change_pct: isFinite(Number(r.changePercent)) ? Number(r.changePercent) : null,
    prev_price: isFinite(Number(r.previousClose)) && Number(r.previousClose) > 0 ? Number(r.previousClose) : null,
    source: 'A3 Mercados',
  }
}

/**
 * Fetch every configured product and return { rows, errors, empty }.
 * Sanity: a price that moved >20% vs previous close is dropped and reported —
 * better a hole in the ticker than a wrong number in front of productores.
 */
export async function fetchMarketData() {
  const rows = []
  const errors = []
  const empty = []

  for (const p of FUTURE_PRODUCTS) {
    try {
      const latest = latestBySymbol(await fetchA3ClosingPrices(p.a3))
        .filter((r) => Number(r.settlement) > 0)
        .sort((a, b) => maturityOf(a.symbol) - maturityOf(b.symbol))
        .slice(0, p.positions)
      if (!latest.length) empty.push(p.a3)
      for (const r of latest) {
        const row = toRow({ market: 'futuros', product: p.product, r })
        if (row) rows.push(row)
      }
    } catch (err) {
      logger.error(`markets: ${p.a3} failed: ${err.message}`)
      errors.push({ product: p.a3, error: err.message })
    }
  }

  for (const p of DISPONIBLE_PRODUCTS) {
    try {
      const latest = latestBySymbol(await fetchA3ClosingPrices(p.a3))
        .filter((r) => Number(r.settlement) > 0)
        .sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime))
        .slice(0, 1)
      if (!latest.length) empty.push(p.a3)
      for (const r of latest) {
        const row = toRow({ market: 'disponible', product: p.product, r })
        if (row) rows.push(row)
      }
    } catch (err) {
      logger.error(`markets: ${p.a3} failed: ${err.message}`)
      errors.push({ product: p.a3, error: err.message })
    }
  }

  // Sanity check against implausible jumps.
  const sane = rows.filter((r) => {
    if (r.prev_price && Math.abs(r.price - r.prev_price) / r.prev_price > 0.2) {
      logger.error(`markets: implausible move dropped: ${r.symbol} ${r.prev_price} → ${r.price}`)
      errors.push({ product: r.symbol, error: `implausible move ${r.prev_price} → ${r.price}` })
      return false
    }
    return true
  })

  return { rows: sane, errors, empty }
}

/** Upsert into Supabase market_data (unique on day+market+symbol). */
export async function saveMarketData(rows) {
  if (!rows.length) return { saved: 0 }
  const { error } = await supabaseService.supabase
    .from('market_data')
    .upsert(rows, { onConflict: 'day,market,symbol' })
  if (error) throw new Error(`Supabase market_data: ${error.message}`)
  return { saved: rows.length }
}

export default { fetchMarketData, saveMarketData }
