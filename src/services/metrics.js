// ── Production metrics (the "Producción" cockpit's data source) ─────────────
//
// One shot of the last N Argentine days of production, counted from the two
// systems of record:
//   - DRAFTS    → Airtable: every record created in the window, per table, with
//                 its `section` (display name), `front` (homepage box) and the
//                 review gate's verdict prefix in `aiReview`.
//   - PUBLISHED → Supabase `articles`: rows only exist once something was
//                 published to the site, so created_at in the window IS the
//                 publication count (verified live: all rows are status
//                 'published'). `section`/`front` are already ids.
//
// Days are Argentine days (ART = UTC-3, no DST): a day runs 03:00Z → 03:00Z.
// The daily pauta (day-sheet quotas, weekday vs weekend) rides along per day so
// the trend chart can draw production against the target.

import axios from 'axios'
import config from '../config/index.js'
import { SECTIONS, getSection } from '../config/sections.js'
import { getBlock, HOMEPAGE_BLOCKS } from '../config/homepage-blocks.js'
import { daySheetFor } from '../config/day-sheet.js'
import supabaseService from './supabase.js'
import logger from '../utils/logger.js'

const ART_TZ = 'America/Argentina/Buenos_Aires'
const ART_DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: ART_TZ }) // YYYY-MM-DD

/** ISO instant → Argentine calendar date 'YYYY-MM-DD'. */
function artDay(iso) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : ART_DAY_FMT.format(d)
}

/** The last `n` Argentine days, oldest → today. */
function lastArtDays(n) {
  const days = []
  const now = Date.now()
  for (let i = n - 1; i >= 0; i--) {
    days.push(ART_DAY_FMT.format(new Date(now - i * 86400000)))
  }
  return days
}

// Airtable display name ("Deportes") → Supabase section id ("deportes").
// Inverse of the insertRecords boundary conversion; unknown names fall back to
// a normalized slug so a hand-typed value still lands near the right bucket.
const NAME_TO_ID = new Map(SECTIONS.map((s) => [s.name, s.id]))
const ID_SET = new Set(SECTIONS.map((s) => s.id))
function sectionIdFromAirtable(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (ID_SET.has(raw)) return raw
  if (NAME_TO_ID.has(raw)) return NAME_TO_ID.get(raw)
  const slug = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return ID_SET.has(slug) ? slug : raw
}

// ── Airtable: all records created in the window, per table ──────────────────
// fetchRecords() drops Airtable's `offset`, capping at 100 records — not enough
// for 30 days of a high-quota table, so this pages the REST API directly.
// fields[] keeps the payload tiny (no article bodies); if a table lacks one of
// the fields Airtable 422s, so we retry that table unfiltered.
const DRAFT_FIELDS = ['section', 'front', 'aiReview']
const MAX_PAGES = 15 // 1500 records/table — far above any real month

async function fetchTableWindow(section, sinceIso) {
  const base = `https://api.airtable.com/v0/${config.airtable.baseId}/${encodeURIComponent(section.tableName)}`
  const headers = { Authorization: `Bearer ${config.airtable.personalAccessToken}` }

  async function page(withFields) {
    const records = []
    let offset = null
    for (let i = 0; i < MAX_PAGES; i++) {
      const params = new URLSearchParams()
      params.append('filterByFormula', `IS_AFTER(CREATED_TIME(), '${sinceIso}')`)
      params.append('pageSize', '100')
      if (withFields) for (const f of DRAFT_FIELDS) params.append('fields[]', f)
      if (offset) params.append('offset', offset)
      const { data } = await axios.get(`${base}?${params}`, { headers })
      records.push(...(data.records || []))
      offset = data.offset
      if (!offset) break
    }
    return records
  }

  try {
    return await page(true)
  } catch (err) {
    if (err.response?.status === 422) return page(false)
    throw err
  }
}

// ── Supabase: everything published in the window ────────────────────────────
async function fetchPublishedWindow(sinceIso) {
  const rows = []
  const PAGE = 1000
  for (let from = 0; from < 20000; from += PAGE) {
    const { data, error } = await supabaseService.supabase
      .from('articles')
      .select('section, front, created_at')
      .gte('created_at', sinceIso)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Supabase: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

const bump = (map, key, by = 1) => map.set(key, (map.get(key) || 0) + by)

/**
 * Build the cockpit payload for the last `windowDays` Argentine days.
 * Everything is counted server-side; the client only draws.
 */
export async function buildProductionMetrics({ windowDays = 30 } = {}) {
  const dayKeys = lastArtDays(windowDays)
  const sinceIso = `${dayKeys[0]}T03:00:00.000Z`

  // Tables worth counting: every configured news/recurring table; the social/
  // config helpers are workflow state, not production.
  const tables = config.sections.filter(
    (s) => s.tableName && !/social|config|settings/i.test(s.tableName),
  )

  const draftsByDay = new Map()
  const draftsBySection = new Map()
  const draftsByFront = new Map()
  const tableRows = []
  const verdicts = { publish: 0, hold: 0, reject: 0, pending: 0 }
  const tableErrors = []

  const CHUNK = 4 // Airtable: 5 req/s per base
  for (let i = 0; i < tables.length; i += CHUNK) {
    await Promise.all(
      tables.slice(i, i + CHUNK).map(async (t) => {
        try {
          const records = await fetchTableWindow(t, sinceIso)
          for (const rec of records) {
            const day = artDay(rec.createdTime)
            if (day) bump(draftsByDay, day)
            const sec = sectionIdFromAirtable(rec.fields?.section)
            bump(draftsBySection, sec || '(sin sección)')
            if (rec.fields?.front) bump(draftsByFront, rec.fields.front)
            const v = String(rec.fields?.aiReview || '').split('·')[0].trim().toLowerCase()
            verdicts[v in verdicts ? v : 'pending'] += 1
          }
          tableRows.push({ feedId: t.id, name: t.name, drafts: records.length })
        } catch (err) {
          logger.error(`metrics: table ${t.id} failed: ${err.message}`)
          tableErrors.push({ feedId: t.id, error: err.message })
        }
      }),
    )
  }

  const published = await fetchPublishedWindow(sinceIso)
  const publishedByDay = new Map()
  const publishedBySection = new Map()
  const publishedByFront = new Map()
  for (const row of published) {
    const day = artDay(row.created_at)
    if (day) bump(publishedByDay, day)
    bump(publishedBySection, row.section || '(sin sección)')
    if (row.front) bump(publishedByFront, row.front)
  }

  // Daily pauta: quotas differ weekday/weekend, so resolve per calendar day
  // (noon ART pins the date regardless of server timezone).
  const days = dayKeys.map((date) => ({
    date,
    drafts: draftsByDay.get(date) || 0,
    published: publishedByDay.get(date) || 0,
    quota: daySheetFor(new Date(`${date}T12:00:00-03:00`)).reduce((s, r) => s + r.quota, 0),
  }))

  // Merge the two sides into one row per section / per homepage box. Seeded
  // with the FULL catalogs so every section and every box appears — zeros
  // included; the cockpit shows complete data, nothing folded away.
  const sectionIds = new Set([
    ...SECTIONS.map((s) => s.id),
    ...draftsBySection.keys(),
    ...publishedBySection.keys(),
  ])
  const sections = [...sectionIds]
    .map((id) => ({
      id,
      name: getSection(id)?.name || id,
      drafts: draftsBySection.get(id) || 0,
      published: publishedBySection.get(id) || 0,
    }))
    .sort(
      (a, b) =>
        b.published - a.published ||
        b.drafts - a.drafts ||
        a.name.localeCompare(b.name, 'es'),
    )

  const frontIds = new Set([
    ...HOMEPAGE_BLOCKS.map((b) => b.front),
    ...draftsByFront.keys(),
    ...publishedByFront.keys(),
  ])
  const fronts = [...frontIds]
    .map((id) => ({
      id,
      label: getBlock(id)?.label || id,
      drafts: draftsByFront.get(id) || 0,
      published: publishedByFront.get(id) || 0,
    }))
    .sort(
      (a, b) =>
        b.published - a.published ||
        b.drafts - a.drafts ||
        a.label.localeCompare(b.label, 'es'),
    )

  tableRows.sort((a, b) => b.drafts - a.drafts)

  const today = days[days.length - 1]
  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    days,
    sections,
    fronts,
    tables: tableRows,
    verdicts,
    totals: {
      drafts: days.reduce((s, d) => s + d.drafts, 0),
      published: days.reduce((s, d) => s + d.published, 0),
    },
    today,
    tableErrors,
  }
}

export default { buildProductionMetrics }
