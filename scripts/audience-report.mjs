// Audience & SEO report — the demand side of the pipeline.
//
// Pulls 90 days from GA4 (Data API) + Search Console, joins per-URL reads with
// Supabase articles (slug → sección/caja/título), and renders a self-contained
// HTML report (print-ready, Chart.js inlined) plus a JSON snapshot.
//
// Auth: service account key at GOOGLE_APPLICATION_CREDENTIALS (.env), granted
// Viewer on the GA4 property and (optionally) reader on Search Console.
// Run:  node scripts/audience-report.mjs            → reports/audiencia-<date>.{html,json}
//       DAYS=30 node scripts/audience-report.mjs    → different window
//
// PDF:  google-chrome --headless --print-to-pdf=informe.pdf reports/audiencia-<date>.html

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

for (const line of fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const PROPERTY = `properties/${process.env.GA4_PROPERTY_ID || '483425157'}`
const DAYS = Math.min(365, Math.max(7, Number(process.env.DAYS) || 90))
const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
if (!KEY_PATH || !fs.existsSync(KEY_PATH)) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS missing or file not found — see script header.')
  process.exit(1)
}

// Cities counted as "the region" (sudoeste bonaerense). GA city names arrive
// unaccented; match accent-insensitively. Partido = the paper's home turf.
const PARTIDO = ['coronel suarez', 'huanguelen', 'santa trinidad', 'san jose', 'santa maria']
const REGION_EXTRA = [
  'pigue', 'saavedra', 'guamini', 'casbas', 'puan', 'darregueira', 'tornquist',
  'coronel pringles', 'general la madrid', 'daireaux', 'salliquelo', 'tres lomas',
  'bahia blanca', 'olavarria', 'laprida',
]
const deacc = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

// ── Google auth: service-account JWT → access token ─────────────────────────
async function googleToken() {
  const key = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'))
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const body = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly',
    aud: key.token_uri, iat: now, exp: now + 3600,
  })}`
  const sig = crypto.createSign('RSA-SHA256').update(body).sign(key.private_key).toString('base64url')
  const res = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${body}.${sig}` }),
  })
  const tok = await res.json()
  if (!tok.access_token) throw new Error(`Google token failed: ${JSON.stringify(tok)}`)
  return tok.access_token
}

const H = { Authorization: '', 'Content-Type': 'application/json' }

async function ga(reportBody) {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${PROPERTY}:runReport`, {
    method: 'POST', headers: H, body: JSON.stringify(reportBody),
  })
  const data = await res.json()
  if (data.error) throw new Error(`GA4: ${data.error.message}`)
  return (data.rows || []).map((r) => ({
    dims: (r.dimensionValues || []).map((d) => d.value),
    mets: (r.metricValues || []).map((m) => Number(m.value)),
  }))
}

// ── Pull everything ──────────────────────────────────────────────────────────
console.log(`Pulling ${DAYS} days from GA4 ${PROPERTY}...`)
H.Authorization = `Bearer ${await googleToken()}`
const range = { startDate: `${DAYS}daysAgo`, endDate: 'today' }
// Headline numbers are Argentina-only: a third of raw "users" turned out to be
// data-center traffic (Singapore et al) — not readers, not sellable. The raw
// global total survives as a footnote via `totalsGlobal`.
const AR = { filter: { fieldName: 'country', stringFilter: { value: 'Argentina' } } }

const [totalsR, totalsGlobalR, daily, cities, channels, pages] = await Promise.all([
  ga({ dateRanges: [range], dimensionFilter: AR, metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }, { name: 'sessions' }, { name: 'averageSessionDuration' }, { name: 'engagementRate' }, { name: 'newUsers' }] }),
  ga({ dateRanges: [range], metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }] }),
  ga({ dateRanges: [range], dimensionFilter: AR, dimensions: [{ name: 'date' }], metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }], orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 400 }),
  ga({ dateRanges: [range], dimensionFilter: AR, dimensions: [{ name: 'city' }], metrics: [{ name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }], limit: 100 }),
  ga({ dateRanges: [range], dimensionFilter: AR, dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }] }),
  ga({ dateRanges: [range], dimensionFilter: AR, dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 2000 }),
])
const TG = totalsGlobalR[0]?.mets || [0, 0]
const T = totalsR[0]?.mets || [0, 0, 0, 0, 0, 0]

// ── Supabase articles for the slug join ─────────────────────────────────────
console.log('Pulling articles from Supabase...')
const supabaseService = (await import('../src/services/supabase.js')).default
const { sectionName, isValidSection } = await import('../src/config/sections.js')
const articles = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabaseService.supabase
    .from('articles').select('slug, title, section, front, created_at').range(from, from + 999)
  if (error) throw new Error(`Supabase: ${error.message}`)
  articles.push(...(data || []))
  if (!data || data.length < 1000) break
}
const bySlug = new Map(articles.map((a) => [a.slug, a]))

// Classify every GA path: article (joined), portada, sección page, or other.
const secReads = new Map()   // section id → pageviews
const frontReads = new Map() // front id → pageviews
const topNotes = []
let articleViews = 0, portadaViews = 0, seccionViews = 0, otherViews = 0
for (const row of pages) {
  const [rawPath] = row.dims
  const [views] = row.mets
  const p = decodeURIComponent(rawPath).replace(/\/+$/, '') || '/'
  if (p === '/') { portadaViews += views; continue }
  // Articles live at /<sección>/(<sub>/)<slug> — the slug is the LAST segment.
  const segs = p.split('/').filter(Boolean)
  const art = bySlug.get(segs[segs.length - 1])
  if (!art) {
    // Bare section paths (/huanguelen, /secciones, /tema/...) are section pages.
    if (segs[0] === 'secciones' || segs[0] === 'tema' || isValidSection(segs[0])) seccionViews += views
    else otherViews += views
    continue
  }
  articleViews += views
  const sec = art.section || '(sin sección)'
  secReads.set(sec, (secReads.get(sec) || 0) + views)
  if (art.front) frontReads.set(art.front, (frontReads.get(art.front) || 0) + views)
  topNotes.push({ title: art.title, section: sec, views })
}
topNotes.sort((a, b) => b.views - a.views)

// Region share from cities.
let partidoUsers = 0, regionUsers = 0, cityTotal = 0
const cityRows = cities.map((r) => {
  const name = r.dims[0] || '(desconocida)'
  const users = r.mets[0]
  cityTotal += users
  const d = deacc(name)
  const inPartido = PARTIDO.some((c) => d.includes(c))
  const inRegion = inPartido || REGION_EXTRA.some((c) => d.includes(c))
  if (inPartido) partidoUsers += users
  if (inRegion) regionUsers += users
  return { name, users, region: inRegion }
})

// ── Search Console (optional) ────────────────────────────────────────────────
let sc = null
try {
  const sites = await (await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites', { headers: H })).json()
  const site = (sites.siteEntry || []).find((s) => /volga/i.test(s.siteUrl))
  if (site) {
    const scq = async (body) => {
      const res = await fetch(
        `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site.siteUrl)}/searchAnalytics/query`,
        { method: 'POST', headers: H, body: JSON.stringify(body) },
      )
      const d = await res.json()
      if (d.error) throw new Error(d.error.message)
      return d.rows || []
    }
    const end = new Date().toISOString().slice(0, 10)
    const start = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10)
    const [scTotals, scQueries] = await Promise.all([
      scq({ startDate: start, endDate: end, dimensions: ['date'], rowLimit: 400 }),
      scq({ startDate: start, endDate: end, dimensions: ['query'], rowLimit: 20 }),
    ])
    sc = {
      site: site.siteUrl,
      clicks: scTotals.reduce((s, r) => s + r.clicks, 0),
      impressions: scTotals.reduce((s, r) => s + r.impressions, 0),
      byDate: scTotals.map((r) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
      topQueries: scQueries.map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: +r.position.toFixed(1) })),
    }
    console.log(`Search Console OK (${site.siteUrl}): ${sc.clicks} clicks / ${sc.impressions} impressions`)
  } else {
    console.log('Search Console: no verified site matching "volga" visible to the service account — skipping SEO block.')
  }
} catch (e) {
  console.log(`Search Console skipped: ${e.message}`)
}

// ── Snapshot ─────────────────────────────────────────────────────────────────
const snapshot = {
  generatedAt: new Date().toISOString(),
  windowDays: DAYS,
  totalsGlobal: { users: TG[0], pageviews: TG[1] },
  totals: { users: T[0], pageviews: T[1], sessions: T[2], avgSessionSec: Math.round(T[3]), engagementRate: +(T[4] * 100).toFixed(1), newUsers: T[5] },
  daily: daily.map((r) => ({ date: r.dims[0], users: r.mets[0], pageviews: r.mets[1] })),
  channels: channels.map((r) => ({ channel: r.dims[0], sessions: r.mets[0] })),
  cities: cityRows.slice(0, 25),
  geo: {
    partidoUsers, regionUsers, cityTotal,
    partidoPct: cityTotal ? +((partidoUsers / cityTotal) * 100).toFixed(1) : 0,
    regionPct: cityTotal ? +((regionUsers / cityTotal) * 100).toFixed(1) : 0,
  },
  pagesplit: { articleViews, portadaViews, seccionViews, otherViews },
  sections: [...secReads.entries()].map(([id, views]) => ({ id, views })).sort((a, b) => b.views - a.views),
  fronts: [...frontReads.entries()].map(([id, views]) => ({ id, views })).sort((a, b) => b.views - a.views),
  topNotes: topNotes.slice(0, 15),
  searchConsole: sc,
}

fs.mkdirSync('reports', { recursive: true })
const stamp = new Date().toISOString().slice(0, 10)
fs.writeFileSync(`reports/audiencia-${stamp}.json`, JSON.stringify(snapshot, null, 2))

// ── HTML report ──────────────────────────────────────────────────────────────
const chartjs = fs.readFileSync('public/vendor/chart.umd.min.js', 'utf8')
const nf = (n) => Number(n).toLocaleString('es-AR')
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
// Same identity-color convention as the admin: hash of the id → stable hue.
const idColor = (id, l = 42) => {
  let h = 5381
  const s = String(id)
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return `hsl(${((h % 360) + 360) % 360}, 62%, ${l}%)`
}
const fmtDate = (yyyymmdd) => {
  const d = String(yyyymmdd).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')
  return new Date(`${d}T12:00:00-03:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
}
const kpi = (v, l, s) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`

const s7 = snapshot.daily.slice(-7).reduce((a, d) => a + d.users, 0)
const p7 = snapshot.daily.slice(-14, -7).reduce((a, d) => a + d.users, 0)
const weekTrend = p7 ? Math.round(((s7 - p7) / p7) * 100) : 0
const organic = snapshot.channels.find((c) => /organic search/i.test(c.channel))
const organicPct = snapshot.totals.sessions ? Math.round(((organic?.sessions || 0) / snapshot.totals.sessions) * 100) : 0
const periodo = `${new Date(Date.now() - DAYS * 86400000).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })} — ${new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}`

const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>Radio del Volga — Informe de audiencia</title>
<script>${chartjs}</script>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #0b0b0b; background: #fff; padding: 36px 44px; max-width: 980px; margin: 0 auto; }
  h1 { font-size: 26px; letter-spacing: -.5px; }
  .sub { color: #52514e; font-size: 13px; margin: 4px 0 26px; }
  h2 { font-size: 15px; margin: 30px 0 10px; color: #0b0b0b; }
  .note { font-size: 11.5px; color: #898781; margin-top: 6px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
  .kpi { border: 1px solid #e1e0d9; border-radius: 10px; padding: 12px 14px; }
  .kpi .v { font-size: 26px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -.5px; }
  .kpi .l { font-size: 11.5px; color: #52514e; margin-top: 3px; }
  .kpi .s { font-size: 10.5px; color: #898781; margin-top: 1px; }
  .chart { position: relative; height: 240px; margin-top: 6px; }
  .chart-sm { height: 200px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 6px; }
  th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .4px; color: #898781; padding: 5px 8px; border-bottom: 2px solid #e1e0d9; }
  td { padding: 5px 8px; border-bottom: 1px solid #f0efe9; font-variant-numeric: tabular-nums; }
  td.n, th.n { text-align: right; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .pill { display: inline-block; font-size: 11px; background: #f4f3ee; border-radius: 999px; padding: 2px 9px; color: #52514e; }
  .footer { margin-top: 34px; padding-top: 12px; border-top: 1px solid #e1e0d9; font-size: 10.5px; color: #898781; }
  @media print { body { padding: 20px 26px; } .chart { height: 210px; } h2 { page-break-after: avoid; } .kpis, .chart, table { page-break-inside: avoid; } }
</style></head><body>
<h1>📻 Radio del Volga — Informe de audiencia</h1>
<p class="sub">Sitio de noticias · ${periodo} (últimos ${DAYS} días) · lectores en Argentina · fuente: Google Analytics${sc ? ' + Google Search Console' : ''}</p>

<div class="kpis">
  ${kpi(nf(snapshot.totals.users), 'Lectores únicos', `${nf(Math.round(snapshot.totals.users / DAYS))} por día`)}
  ${kpi(nf(snapshot.totals.pageviews), 'Páginas vistas', `${nf(Math.round(snapshot.totals.pageviews / DAYS))} por día`)}
  ${kpi(nf(snapshot.totals.sessions), 'Visitas (sesiones)', '')}
  ${kpi(`${snapshot.geo.regionPct}%`, 'Lectores de la región', `${snapshot.geo.partidoPct}% del partido de C. Suárez`)}
  ${kpi(`${organicPct}%`, 'Llegan por búsqueda de Google', 'SEO orgánico')}
  ${kpi(`${weekTrend >= 0 ? '+' : ''}${weekTrend}%`, 'Última semana vs anterior', 'lectores únicos')}
</div>

<h2>Lectores por día</h2>
<div class="chart"><canvas id="daily"></canvas></div>

<div class="grid2">
  <div>
    <h2>Cómo llegan los lectores</h2>
    <div class="chart chart-sm"><canvas id="channels"></canvas></div>
  </div>
  <div>
    <h2>De dónde son (top ciudades)</h2>
    <table><thead><tr><th>Ciudad</th><th class="n">Lectores</th><th class="n">%</th></tr></thead><tbody>
      ${snapshot.cities.slice(0, 10).map((c) => `<tr><td>${esc(c.name)}${c.region ? ' <span class="pill">región</span>' : ''}</td><td class="n">${nf(c.users)}</td><td class="n">${((c.users / snapshot.geo.cityTotal) * 100).toFixed(1)}%</td></tr>`).join('')}
    </tbody></table>
  </div>
</div>

<h2>Qué se lee — lecturas por sección</h2>
<div class="chart" id="secbox"><canvas id="sections"></canvas></div>
<p class="note">Lecturas de notas identificadas: ${nf(articleViews)} · portada: ${nf(portadaViews)} · páginas de sección: ${nf(seccionViews)} · otras: ${nf(otherViews)}.</p>

<h2>Las notas más leídas</h2>
<table><thead><tr><th>#</th><th>Nota</th><th>Sección</th><th class="n">Lecturas</th></tr></thead><tbody>
  ${snapshot.topNotes.map((t, i) => `<tr><td>${i + 1}</td><td>${esc(String(t.title || '').slice(0, 90))}</td><td><span class="dot" style="background:${idColor(t.section)}"></span>${esc(sectionName(t.section))}</td><td class="n">${nf(t.views)}</td></tr>`).join('')}
</tbody></table>

${sc ? `
<h2>Google — búsqueda (SEO)</h2>
<div class="kpis">
  ${kpi(nf(sc.impressions), 'Veces que aparecimos en Google', 'impresiones')}
  ${kpi(nf(sc.clicks), 'Clicks desde Google', `CTR ${sc.impressions ? ((sc.clicks / sc.impressions) * 100).toFixed(1) : 0}%`)}
</div>
<div class="grid2" style="margin-top:14px;">
  <div><h2 style="margin-top:0;">Impresiones y clicks por día</h2><div class="chart chart-sm"><canvas id="sc"></canvas></div></div>
  <div><h2 style="margin-top:0;">Qué buscan para encontrarnos</h2>
  <table><thead><tr><th>Búsqueda</th><th class="n">Clicks</th><th class="n">Posición</th></tr></thead><tbody>
    ${sc.topQueries.slice(0, 10).map((q) => `<tr><td>${esc(q.query)}</td><td class="n">${nf(q.clicks)}</td><td class="n">${q.position}</td></tr>`).join('')}
  </tbody></table></div>
</div>` : ''}

<div class="footer">Generado ${new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })} · GA4 propiedad rdv-db (${PROPERTY.replace('properties/', '')}) · Lecturas por sección = páginas vistas de notas cuyo slug existe en la base del sitio. Ciudades según geolocalización de Google (aprox.). Cifras de lectores = tráfico desde Argentina; el total global del período (${nf(TG[0])} usuarios / ${nf(TG[1])} vistas) incluye tráfico de bots y data centers del exterior y no se usa como métrica de audiencia.</div>

<script>
const INK = { grid: '#e1e0d9', axis: '#c3c2b7', tick: '#898781', label: '#52514e' };
const BLUE = '#2a78d6', AQUA = '#1baf7a';
const DAILY = ${JSON.stringify(snapshot.daily.map((d) => ({ l: fmtDate(d.date), u: d.users, p: d.pageviews })))};
new Chart(document.getElementById('daily'), {
  type: 'line',
  data: { labels: DAILY.map(d => d.l), datasets: [
    { label: 'Lectores', data: DAILY.map(d => d.u), borderColor: BLUE, backgroundColor: BLUE, borderWidth: 2, pointRadius: 0, tension: .25 },
    { label: 'Páginas vistas', data: DAILY.map(d => d.p), borderColor: AQUA, backgroundColor: AQUA, borderWidth: 2, pointRadius: 0, tension: .25 },
  ]},
  options: { animation: false, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'top', align: 'end', labels: { usePointStyle: true, pointStyle: 'line', boxHeight: 8, color: INK.label, font: { size: 11 } } } },
    scales: { x: { grid: { display: false }, border: { color: INK.axis }, ticks: { color: INK.tick, maxTicksLimit: 12, maxRotation: 0 } },
              y: { beginAtZero: true, grid: { color: INK.grid }, border: { display: false }, ticks: { color: INK.tick, precision: 0 } } } }
});
const CH = ${JSON.stringify(snapshot.channels.map((c) => ({ l: c.channel, v: c.sessions })))};
new Chart(document.getElementById('channels'), {
  type: 'bar',
  data: { labels: CH.map(c => c.l), datasets: [{ data: CH.map(c => c.v), backgroundColor: BLUE, borderRadius: 4, barThickness: 16 }] },
  options: { indexAxis: 'y', animation: false, maintainAspectRatio: false, layout: { padding: { right: 40 } }, plugins: { legend: { display: false } },
    scales: { x: { grid: { color: INK.grid }, border: { color: INK.axis }, ticks: { color: INK.tick, precision: 0 } },
              y: { grid: { display: false }, border: { color: INK.axis }, ticks: { color: INK.label, autoSkip: false, font: { size: 11 } } } } }
});
const barLabels = { id: 'barLabels', afterDatasetsDraw(chart) {
  const { ctx } = chart; ctx.save(); ctx.font = '10px system-ui'; ctx.fillStyle = INK.label; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  chart.data.datasets.forEach((ds, di) => { chart.getDatasetMeta(di).data.forEach((bar, i) => { if (ds.data[i] > 0) ctx.fillText(String(ds.data[i].toLocaleString('es-AR')), bar.x + 5, bar.y); }); }); ctx.restore();
}};
const SEC = ${JSON.stringify(snapshot.sections.slice(0, 20).map((s) => ({ id: s.id, l: sectionName(s.id), v: s.views })))};
document.getElementById('secbox').style.height = (SEC.length * 26 + 30) + 'px';
new Chart(document.getElementById('sections'), {
  type: 'bar',
  data: { labels: SEC.map(s => s.l), datasets: [{ data: SEC.map(s => s.v), backgroundColor: SEC.map(s => (${idColor.toString()})(s.id, 46)), borderRadius: 4, barThickness: 13 }] },
  plugins: [barLabels],
  options: { indexAxis: 'y', animation: false, maintainAspectRatio: false, layout: { padding: { right: 55 } }, plugins: { legend: { display: false } },
    scales: { x: { grid: { color: INK.grid }, border: { color: INK.axis }, ticks: { color: INK.tick, precision: 0 } },
              y: { grid: { display: false }, border: { color: INK.axis }, ticks: { color: INK.label, autoSkip: false, font: { size: 11 } } } } }
});
${sc ? `
const SC = ${JSON.stringify((sc.byDate || []).map((d) => ({ l: new Date(d.date + 'T12:00:00-03:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }), c: d.clicks, i: d.impressions })))};
new Chart(document.getElementById('sc'), {
  type: 'line',
  data: { labels: SC.map(d => d.l), datasets: [
    { label: 'Impresiones', data: SC.map(d => d.i), borderColor: BLUE, backgroundColor: BLUE, borderWidth: 2, pointRadius: 0, tension: .25 },
    { label: 'Clicks', data: SC.map(d => d.c), borderColor: AQUA, backgroundColor: AQUA, borderWidth: 2, pointRadius: 0, tension: .25 },
  ]},
  options: { animation: false, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'top', align: 'end', labels: { usePointStyle: true, pointStyle: 'line', boxHeight: 8, color: INK.label, font: { size: 11 } } } },
    scales: { x: { grid: { display: false }, border: { color: INK.axis }, ticks: { color: INK.tick, maxTicksLimit: 8, maxRotation: 0 } },
              y: { beginAtZero: true, grid: { color: INK.grid }, border: { display: false }, ticks: { color: INK.tick, precision: 0 } } } }
});` : ''}
</script></body></html>`

fs.writeFileSync(`reports/audiencia-${stamp}.html`, html)

console.log(`\n── Resumen (${DAYS} días) ────────────────────────────`)
console.log(`Lectores únicos: ${nf(T[0])} · Páginas vistas: ${nf(T[1])} · Sesiones: ${nf(T[2])}`)
console.log(`Región: ${snapshot.geo.regionPct}% (partido: ${snapshot.geo.partidoPct}%) · Google orgánico: ${organicPct}% de sesiones`)
console.log(`Notas identificadas: ${nf(articleViews)} lecturas en ${snapshot.sections.length} secciones · top: ${snapshot.topNotes[0]?.title?.slice(0, 60) || '—'}`)
console.log(`\nEscrito: reports/audiencia-${stamp}.html + .json`)
