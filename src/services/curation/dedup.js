import { createClient } from '@supabase/supabase-js'
import Airtable from 'airtable'
import config from '../../config/index.js'

// Serverless-safe dedup: query persistent stores, never the .state file ledger
// (Vercel's filesystem is ephemeral). Mirrors the Slack URL-lookup pattern.

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
)

const airtable = new Airtable({
  apiKey: process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY,
}).base(process.env.AIRTABLE_BASE_ID)

// Chunk an array (Airtable formulas + Supabase .in() shouldn't get huge).
function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

async function existingInSupabase(urls) {
  const found = new Set()
  for (const part of chunk(urls, 100)) {
    const { data, error } = await supabase
      .from('articles')
      .select('url')
      .in('url', part)
    if (!error && data) data.forEach((r) => r.url && found.add(r.url))
  }
  return found
}

async function existingInAirtableTable(tableName, urls) {
  const found = new Set()
  for (const part of chunk(urls, 25)) {
    const formula = `OR(${part
      .map((u) => `{url}="${String(u).replace(/"/g, '\\"')}"`)
      .join(',')})`
    try {
      const records = await airtable(tableName)
        .select({ filterByFormula: formula, fields: ['url'] })
        .all()
      records.forEach((r) => {
        const u = r.get('url')
        if (u) found.add(u)
      })
    } catch {
      // Missing table / transient error: don't block the run on dedup.
    }
  }
  return found
}

/**
 * Remove candidates whose url already exists as a published article (Supabase)
 * or a draft (its feed's Airtable table).
 * @returns {Promise<{unique: Array, skipped: Array}>}
 */
export async function filterDuplicates({ candidates = [] } = {}) {
  if (!candidates.length) return { unique: [], skipped: [] }

  const urls = [...new Set(candidates.map((c) => c.url))]
  const publishedUrls = await existingInSupabase(urls)

  // Group by Airtable table (= feed's config tableName) for batched lookups.
  const byTable = new Map()
  for (const c of candidates) {
    const section = config.getSection(c.feedId)
    const table = section?.tableName
    if (!table) continue
    if (!byTable.has(table)) byTable.set(table, new Set())
    byTable.get(table).add(c.url)
  }
  const draftUrls = new Set()
  await Promise.all(
    [...byTable.entries()].map(async ([table, set]) => {
      const found = await existingInAirtableTable(table, [...set])
      found.forEach((u) => draftUrls.add(u))
    }),
  )

  const unique = []
  const skipped = []
  for (const c of candidates) {
    if (publishedUrls.has(c.url)) {
      skipped.push({ url: c.url, feedId: c.feedId, reason: 'already-published' })
    } else if (draftUrls.has(c.url)) {
      skipped.push({ url: c.url, feedId: c.feedId, reason: 'already-draft' })
    } else {
      unique.push(c)
    }
  }
  return { unique, skipped }
}
