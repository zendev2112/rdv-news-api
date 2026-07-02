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

// Tables to sweep (defaults to the two with fresh content). Override:
//   node scripts/review-agreement-report.mjs "Local,Instituciones" 8
const TABLES = (process.argv[2] || 'Local,Instituciones').split(',').map((t) => t.trim())
const LIMIT = Number(process.argv[3] || 8)

const baseId = process.env.AIRTABLE_BASE_ID
const token = process.env.AIRTABLE_TOKEN

async function recentDrafts(tableName, limit) {
  const formula = `AND({status}='draft', IS_AFTER(CREATED_TIME(), DATEADD(NOW(), -21, 'days')))`
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`
  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
    params: { filterByFormula: formula, pageSize: 100 },
  })
  // Newest first (record metadata createdTime), then cap — surfaces fresh drafts.
  return (data?.records || [])
    .sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)))
    .slice(0, limit)
    .map((r) => ({ recordId: r.id, fields: r.fields || {}, createdTime: r.createdTime }))
}

const ICON = { publish: '✅', hold: '🟡', reject: '⛔' }
const tally = { publish: 0, hold: 0, reject: 0, unparseable: 0, error: 0 }
const perTable = {}

function snip(s, n) {
  return (s || '').replace(/\s+/g, ' ').trim().slice(0, n)
}

for (const TABLE of TABLES) {
  console.log(`\n${'═'.repeat(72)}\n  TABLE: ${TABLE}   (model ${REVIEW_MODEL})\n${'═'.repeat(72)}`)
  let drafts
  try {
    drafts = await recentDrafts(TABLE, LIMIT)
  } catch (err) {
    console.log(`  ✖ could not read table: ${err.response?.data?.error?.type || err.message}`)
    continue
  }
  if (!drafts.length) {
    console.log('  (no drafts, status=draft, last 21 days)')
    continue
  }
  perTable[TABLE] = { publish: 0, hold: 0, reject: 0 }

  for (const d of drafts) {
    const f = d.fields
    const { params } = buildReviewRequest(d.recordId, f)
    let text
    try {
      text = await generateMessage({ system: params.system, prompt: params.messages[0].content, maxTokens: 256 })
    } catch (err) {
      tally.error++
      console.log(`\n  ✖ ${d.recordId}  API error: ${err.message}`)
      continue
    }
    const v = parseVerdict(text)

    console.log(`\n  ${'─'.repeat(68)}`)
    console.log(`  ${d.recordId}   fuente: ${f.source || '(?)'}   creado: ${(d.createdTime || '').slice(0, 10)}`)
    console.log(`  VOLANTA:  ${snip(f.overline, 90) || '(vacía)'}`)
    console.log(`  TÍTULO:   ${snip(f.title, 90) || '(vacío)'}`)
    console.log(`  BAJADA:   ${snip(f.excerpt, 140) || '(vacía)'}`)
    console.log(`  TAGS:     ${snip(f.tags, 90) || '(vacíos)'}`)
    console.log(`  CUERPO:   ${snip(f.article, 320)}${(f.article || '').length > 320 ? ' …' : ''}`)

    if (!v) {
      tally.unparseable++
      console.log(`  ⚠ CLAUDE: unparseable → ${snip(text, 120)}`)
      continue
    }
    tally[v.verdict]++
    perTable[TABLE][v.verdict]++
    console.log(`  ${ICON[v.verdict]} CLAUDE: ${v.verdict.toUpperCase()} · conf:${v.confidence} · ${v.reason}`)
  }
}

// ── Summary ────────────────────────────────────────────────────────────────
const total = tally.publish + tally.hold + tally.reject
console.log(`\n${'═'.repeat(72)}\n  RESUMEN\n${'═'.repeat(72)}`)
for (const [t, c] of Object.entries(perTable)) {
  console.log(`  ${t.padEnd(16)}  ✅ ${c.publish}   🟡 ${c.hold}   ⛔ ${c.reject}`)
}
console.log(`  ${'─'.repeat(48)}`)
const pct = (n) => (total ? Math.round((n / total) * 100) : 0)
console.log(`  TOTAL (${total})   ✅ ${tally.publish} (${pct(tally.publish)}%)   🟡 ${tally.hold} (${pct(tally.hold)}%)   ⛔ ${tally.reject} (${pct(tally.reject)}%)`)
if (tally.unparseable) console.log(`  ⚠ unparseable: ${tally.unparseable}`)
if (tally.error) console.log(`  ✖ API errors: ${tally.error}`)
console.log(`\n  Nothing was written to Airtable. Read each verdict and tell me where`)
console.log(`  Claude disagrees with what YOU would do — that's the agreement signal.\n`)
