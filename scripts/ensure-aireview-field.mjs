import fs from 'node:fs'
import path from 'node:path'
import axios from 'axios'

// Minimal .env reader (avoids a dotenv dependency in this one-off script).
function loadEnv() {
  const p = path.resolve(process.cwd(), '.env')
  const out = {}
  if (!fs.existsSync(p)) return out
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

const env = loadEnv()
const token = env.AIRTABLE_TOKEN || process.env.AIRTABLE_TOKEN
const baseId = env.AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID
const FIELD = 'aiReview'

if (!token || !baseId) {
  console.error('Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID in .env')
  process.exit(1)
}

const api = axios.create({
  baseURL: 'https://api.airtable.com/v0/meta',
  headers: { Authorization: `Bearer ${token}` },
})

async function main() {
  let tables
  try {
    const { data } = await api.get(`/bases/${baseId}/tables`)
    tables = data.tables
  } catch (err) {
    const status = err.response?.status
    const msg = err.response?.data?.error?.message || err.message
    console.error(`\n✖ Could not list tables (HTTP ${status}): ${msg}`)
    if (status === 403) {
      console.error(
        '→ Token is missing schema.bases:read / schema.bases:write. Add both, then rerun.',
      )
    }
    process.exit(1)
  }

  console.log(`Base has ${tables.length} tables.\n`)

  const dryRun = process.argv.includes('--dry-run')
  let created = 0
  let already = 0
  const failures = []

  for (const t of tables) {
    if (t.fields.some((f) => f.name === FIELD)) {
      already++
      continue
    }
    if (dryRun) {
      console.log(`would create  ${FIELD}  on  "${t.name}"`)
      created++
      continue
    }
    try {
      await api.post(`/bases/${baseId}/tables/${t.id}/fields`, {
        name: FIELD,
        type: 'multilineText',
      })
      console.log(`✓ created  ${FIELD}  on  "${t.name}"`)
      created++
    } catch (err) {
      const status = err.response?.status
      const msg = err.response?.data?.error?.message || err.message
      console.error(`✖ failed   "${t.name}" (HTTP ${status}): ${msg}`)
      failures.push(t.name)
      if (status === 403) {
        console.error('→ Token has read but not schema.bases:WRITE. Add it and rerun.')
        break
      }
    }
  }

  console.log(
    `\nDone. ${already} already had ${FIELD}, ${created} ${dryRun ? 'would be' : ''} created, ${failures.length} failed.`,
  )
  if (failures.length) {
    console.log('Failed tables:', failures.join(', '))
    process.exit(1)
  }
}

main()
