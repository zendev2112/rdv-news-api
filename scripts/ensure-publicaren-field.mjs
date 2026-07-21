// Add a `publicarEn` dateTime field (ART timezone) to every table that has an
// `aprobado` field — the schedule field for delayed publication. Idempotent:
// skips tables that already have it. Run: node scripts/ensure-publicaren-field.mjs

import fs from 'node:fs'
import path from 'node:path'

function loadEnv() {
  const out = {}
  for (const line of fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

const env = loadEnv()
const token = env.AIRTABLE_TOKEN
const baseId = env.AIRTABLE_BASE_ID
if (!token || !baseId) { console.error('Missing AIRTABLE_TOKEN / AIRTABLE_BASE_ID'); process.exit(1) }

const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const FIELD = 'publicarEn'
const FIELD_SPEC = {
  name: FIELD,
  type: 'dateTime',
  description: 'Programar publicación: si está en el futuro, el cron espera hasta esa hora. Vacío = publica en la próxima corrida. Zona horaria Buenos Aires.',
  options: {
    timeZone: 'America/Argentina/Buenos_Aires',
    dateFormat: { name: 'local' },
    timeFormat: { name: '24hour' },
  },
}

const meta = await (await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, { headers: H })).json()
if (!meta.tables) { console.error('Could not list tables:', JSON.stringify(meta).slice(0, 200)); process.exit(1) }

let added = 0, skipped = 0, noAprobado = 0
for (const t of meta.tables) {
  const names = t.fields.map((f) => f.name)
  const hasAprobado = names.includes('aprobado')
  const hasPublicarEn = names.includes(FIELD)
  if (!hasAprobado) { noAprobado++; continue }
  if (hasPublicarEn) { console.log(`= ${t.name}: already has ${FIELD}`); skipped++; continue }
  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables/${t.id}/fields`, {
    method: 'POST', headers: H, body: JSON.stringify(FIELD_SPEC),
  })
  const d = await res.json()
  if (res.ok) { console.log(`+ ${t.name}: created ${FIELD}`); added++ }
  else console.log(`✗ ${t.name}: ${JSON.stringify(d.error).slice(0, 150)}`)
}

console.log(`\nDone — added ${added}, already-present ${skipped}, tables without aprobado (skipped) ${noAprobado}.`)
