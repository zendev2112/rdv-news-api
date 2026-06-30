import fs from 'node:fs'
import path from 'node:path'
import axios from 'axios'

// Load .env into process.env BEFORE importing claude-service (it reads the key lazily).
for (const line of fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const { generateMessage, REVIEW_MODEL } = await import('../src/services/claude-service.js')
const { buildReviewRequest, parseVerdict } = await import('../src/services/curation/review.js')

const TABLE = process.argv[2] || 'Instituciones'
const LIMIT = Number(process.argv[3] || 3)

const baseId = process.env.AIRTABLE_BASE_ID
const token = process.env.AIRTABLE_TOKEN

async function recentDrafts(tableName, limit) {
  const formula = `AND({status}='draft', IS_AFTER(CREATED_TIME(), DATEADD(NOW(), -14, 'days')))`
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`
  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
    params: { filterByFormula: formula, maxRecords: limit },
  })
  return (data?.records || []).map((r) => ({ recordId: r.id, fields: r.fields || {} }))
}

console.log(`\n── READ-ONLY review test · table "${TABLE}" · model ${REVIEW_MODEL} ──\n`)

const drafts = await recentDrafts(TABLE, LIMIT)
if (!drafts.length) {
  console.log('No recent drafts (status=draft, last 14 days) in this table.')
  process.exit(0)
}
console.log(`Found ${drafts.length} recent draft(s). Reviewing synchronously...\n`)

for (const d of drafts) {
  const { params } = buildReviewRequest(d.recordId, d.fields)
  const userPrompt = params.messages[0].content
  let text
  try {
    text = await generateMessage({ system: params.system, prompt: userPrompt, maxTokens: 256 })
  } catch (err) {
    console.log(`✖ ${d.recordId}  API error: ${err.message}\n`)
    continue
  }
  const verdict = parseVerdict(text)
  const title = (d.fields.title || '(sin título)').slice(0, 70)
  console.log(`▸ ${d.recordId}  «${title}»`)
  if (!verdict) {
    console.log(`  unparseable response: ${text}\n`)
    continue
  }
  const tag = verdict.verdict.toUpperCase()
  console.log(`  → ${tag} · conf:${verdict.confidence} · ${verdict.reason}\n`)
}

console.log('── done (nothing written to Airtable) ──\n')
