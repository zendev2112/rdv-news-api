import fs from 'node:fs'
import path from 'node:path'
import axios from 'axios'

for (const line of fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const baseId = process.env.AIRTABLE_BASE_ID
const token = process.env.AIRTABLE_TOKEN
const TABLES = process.argv.slice(2)
if (!TABLES.length) TABLES.push('Local', 'Local Facebook')

// Competitor medios. Each entry: label + regexes that catch the name + variants.
const MEDIOS = [
  { label: 'Radio Ciudad Noticias', re: /radio ciudad noticias/i },
  { label: 'La Nueva Radio Suárez', re: /la nueva radio su[aá]rez|\bla nueva\b/i },
  { label: 'Radio Coronel Suárez', re: /radio coronel su[aá]rez/i },
  { label: 'Suárez al Día', re: /su[aá]rez al d[ií]a/i },
  { label: 'CoronelSuárez Post', re: /coronel\s?su[aá]rez post/i },
]

const FIELDS = ['title', 'overline', 'excerpt', 'article', 'tags']

async function recentDrafts(tableName) {
  const formula = `AND({status}='draft', IS_AFTER(CREATED_TIME(), DATEADD(NOW(), -14, 'days')))`
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`
  try {
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      params: { filterByFormula: formula, maxRecords: 100 },
    })
    return (data?.records || []).map((r) => ({ recordId: r.id, fields: r.fields || {} }))
  } catch (err) {
    console.error(`  list failed for "${tableName}": ${err.response?.data?.error?.message || err.message}`)
    return []
  }
}

console.log('\n── scanning drafts for competitor mentions (read-only) ──')

let totalDrafts = 0
let flagged = 0
for (const table of TABLES) {
  const drafts = await recentDrafts(table)
  totalDrafts += drafts.length
  console.log(`\n# ${table} — ${drafts.length} recent draft(s)`)
  for (const d of drafts) {
    const blob = FIELDS.map((f) => d.fields[f] || '').join('\n')
    const hits = MEDIOS.filter((m) => m.re.test(blob)).map((m) => m.label)
    if (hits.length) {
      flagged++
      const title = (d.fields.title || '(sin título)').slice(0, 60)
      console.log(`  ✗ ${d.recordId}  «${title}»  → names: ${hits.join(', ')}`)
    }
  }
}

console.log(`\n── ${flagged} of ${totalDrafts} draft(s) name a competitor ──\n`)
