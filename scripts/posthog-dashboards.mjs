// Create the RDV Producción dashboard + insights in PostHog via its API.
//
// Requires a PERSONAL API key (phx_...) — the project key (phc_) can only
// capture events. Mint one at PostHog → Settings → User → Personal API keys,
// scopes: dashboard:write, insight:write, project:read. Then add to .env:
//   POSTHOG_PERSONAL_API_KEY=phx_...
// (Local script only — do NOT add this key to Vercel.)
//
// Run:  node scripts/posthog-dashboards.mjs
//
// Idempotent: finds the dashboard and each insight by exact name and skips
// what already exists, so it can be re-run after tweaks. Delete an insight in
// PostHog and re-run to recreate it fresh.
//
// DESIGN NOTE: every event uses the single distinctId 'rdv-pipeline', so
// PostHog FUNNELS (unique-person conversion) are meaningless here — the
// pipeline "funnel" is a multi-series trends insight comparing stage counts.

import fs from 'node:fs'
import path from 'node:path'
import axios from 'axios'

for (const line of fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const KEY = process.env.POSTHOG_PERSONAL_API_KEY
if (!KEY || !KEY.startsWith('phx_')) {
  console.error('Missing POSTHOG_PERSONAL_API_KEY (phx_...) in .env — see header comment.')
  process.exit(1)
}
// App API host (us.posthog.com), NOT the capture host (us.i.posthog.com).
const HOST = (process.env.POSTHOG_APP_HOST || 'https://us.posthog.com').replace(/\/$/, '')
const api = axios.create({ baseURL: HOST, headers: { Authorization: `Bearer ${KEY}` } })

const DASHBOARD_NAME = 'RDV Producción — pipeline'

// One trends series shorthand.
const ev = (id, extra = {}) => ({ id, name: id, type: 'events', ...extra })
const approvedFilter = [{ key: 'value', value: ['true'], operator: 'exact', type: 'event' }]

// The insights. `filters` is PostHog's legacy-but-supported insight format —
// portable and easy to eyeball in the UI's JSON view.
const INSIGHTS = [
  {
    name: 'Pipeline por etapa (diario)',
    description:
      'Cuántas notas pasan por cada etapa por día: generadas → veredicto del gate → aprobadas por el editor → publicadas. (Con un solo distinctId de sistema, el funnel real se lee comparando estas curvas.)',
    filters: {
      insight: 'TRENDS', interval: 'day', date_from: '-30d',
      display: 'ActionsLineGraph',
      events: [
        ev('article_generated', { order: 0, custom_name: 'Generadas' }),
        ev('review_verdict', { order: 1, custom_name: 'Veredictos del gate' }),
        ev('editor_approval', { order: 2, custom_name: 'Aprobadas por el editor', properties: approvedFilter }),
        ev('article_published', { order: 3, custom_name: 'Publicadas' }),
      ],
    },
  },
  {
    name: 'Publicadas por sección (30 días)',
    description: 'Total de notas publicadas por sección del sitio.',
    filters: {
      insight: 'TRENDS', interval: 'day', date_from: '-30d',
      display: 'ActionsBarValue',
      events: [ev('article_published', { order: 0 })],
      breakdown: 'section', breakdown_type: 'event',
    },
  },
  {
    name: 'Publicadas por caja de la portada (30 días)',
    description: 'Total de notas publicadas por caja (front).',
    filters: {
      insight: 'TRENDS', interval: 'day', date_from: '-30d',
      display: 'ActionsBarValue',
      events: [ev('article_published', { order: 0 })],
      breakdown: 'front', breakdown_type: 'event',
    },
  },
  {
    name: 'Generadas por sección (diario)',
    description: 'Borradores generados por día, partidos por sección del sitio.',
    filters: {
      insight: 'TRENDS', interval: 'day', date_from: '-30d',
      display: 'ActionsLineGraph',
      events: [ev('article_generated', { order: 0 })],
      breakdown: 'section', breakdown_type: 'event',
    },
  },
  {
    name: 'Veredictos del gate de revisión',
    description: 'Reparto publish / hold / reject de Claude sobre los borradores.',
    filters: {
      insight: 'TRENDS', interval: 'day', date_from: '-30d',
      display: 'ActionsPie',
      events: [ev('review_verdict', { order: 0 })],
      breakdown: 'verdict', breakdown_type: 'event',
    },
  },
  {
    name: 'Acuerdo en aprobación: qué veredicto tenían las aprobadas',
    description:
      'Aprobaciones del editor partidas por lo que Claude había sugerido. Mucha barra "reject" = desacuerdo (el editor aprueba lo que Claude rechazaría); mucha "publish" = acuerdo.',
    filters: {
      insight: 'TRENDS', interval: 'day', date_from: '-30d',
      display: 'ActionsBarValue',
      events: [ev('editor_approval', { order: 0, properties: approvedFilter })],
      breakdown: 'verdict', breakdown_type: 'event',
    },
  },
  {
    name: 'Acuerdo en selección: kept / removed / added',
    description:
      'Por cada Send del picker: cuántas sugerencias de Claude quedaron (kept), cuántas sacó el editor (removed) y cuántas agregó (added). removed+added altos = las sugerencias necesitan calibración.',
    filters: {
      insight: 'TRENDS', interval: 'day', date_from: '-30d',
      display: 'ActionsLineGraph',
      events: [
        ev('selection_confirmed', { order: 0, custom_name: 'Kept', math: 'sum', math_property: 'kept' }),
        ev('selection_confirmed', { order: 1, custom_name: 'Removed', math: 'sum', math_property: 'removed' }),
        ev('selection_confirmed', { order: 2, custom_name: 'Added', math: 'sum', math_property: 'added' }),
      ],
    },
  },
  {
    name: 'Publicadas: ¿coincidían con el veredicto?',
    description: 'Notas publicadas partidas por el veredicto que tenían al publicarse ("none" = publicadas sin pasar por el gate).',
    filters: {
      insight: 'TRENDS', interval: 'day', date_from: '-30d',
      display: 'ActionsPie',
      events: [ev('article_published', { order: 0 })],
      breakdown: 'verdict', breakdown_type: 'event',
    },
  },
]

// ── Run ─────────────────────────────────────────────────────────────────────
const { data: projects } = await api.get('/api/projects/')
const project = projects.results?.[0]
if (!project) {
  console.error('No PostHog project visible to this key (missing project:read scope?).')
  process.exit(1)
}
console.log(`Project: ${project.name} (id ${project.id})`)

// Dashboard: reuse by exact name, else create.
const { data: dashList } = await api.get(`/api/projects/${project.id}/dashboards/`, {
  params: { search: DASHBOARD_NAME, limit: 50 },
})
let dashboard = (dashList.results || []).find((d) => d.name === DASHBOARD_NAME && !d.deleted)
if (dashboard) {
  console.log(`Dashboard exists: "${DASHBOARD_NAME}" (id ${dashboard.id}) — reusing`)
} else {
  const { data } = await api.post(`/api/projects/${project.id}/dashboards/`, {
    name: DASHBOARD_NAME,
    description:
      'Pipeline editorial RDV: producción por etapa, reparto por sección y caja, y acuerdo Claude↔editor en selección y aprobación. Creado por scripts/posthog-dashboards.mjs.',
    pinned: true,
  })
  dashboard = data
  console.log(`Dashboard created: "${DASHBOARD_NAME}" (id ${dashboard.id})`)
}

// Insights: skip by exact name, else create attached to the dashboard.
const { data: existingList } = await api.get(`/api/projects/${project.id}/insights/`, {
  params: { limit: 300 },
})
const existingNames = new Set((existingList.results || []).filter((i) => !i.deleted).map((i) => i.name))

let created = 0
for (const ins of INSIGHTS) {
  if (existingNames.has(ins.name)) {
    console.log(`  = exists, skipped: ${ins.name}`)
    continue
  }
  try {
    await api.post(`/api/projects/${project.id}/insights/`, {
      name: ins.name,
      description: ins.description,
      filters: ins.filters,
      dashboards: [dashboard.id],
      saved: true,
    })
    created++
    console.log(`  + created: ${ins.name}`)
  } catch (err) {
    const detail = err.response
      ? `${err.response.status} ${JSON.stringify(err.response.data)}`
      : err.message
    console.error(`  ✗ failed: ${ins.name} — ${detail}`)
    if (err.response?.status === 403) {
      console.error('    (403 = the personal key lacks the insight:write scope — edit the key in PostHog Settings → Personal API keys)')
      process.exit(1)
    }
  }
}

console.log(`\nDone — ${created} insight(s) created. Open: ${HOST}/project/${project.id}/dashboard/${dashboard.id}`)
