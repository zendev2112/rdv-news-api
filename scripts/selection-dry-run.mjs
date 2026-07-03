import fs from 'node:fs'
import path from 'node:path'

// Read-only dry run of the admin picker's Claude selection: pull fresh titles
// exactly like curate list mode, compute homepage demand, ask Claude to propose,
// and print picks per source table. Writes NOTHING (no Airtable, no analytics).
//
//   node scripts/selection-dry-run.mjs

// Load .env into process.env BEFORE importing services (keys are read lazily).
for (const line of fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const { pullSupply } = await import('../src/services/curation/supply.js')
const { filterDuplicates } = await import('../src/services/curation/dedup.js')
const { computeDemand } = await import('../src/services/curation/demand.js')
const { selectCandidates, SELECT_MODEL } = await import('../src/services/curation/select.js')
const appConfig = (await import('../src/config/index.js')).default
const { autoFeedableBlocks, feedsForBlocks, blocksForFeed } = await import(
  '../src/config/homepage-blocks.js'
)

function snip(s, n) {
  return (s || '').replace(/\s+/g, ' ').trim().slice(0, n)
}

// ── Build the list-mode feeds shape (mirror of api/agent/curate.js) ──────────
// Every configured table: block-fed news feeds first, then recurring tables.
const blocks = autoFeedableBlocks()
const feedIds = [
  ...new Set([...feedsForBlocks(blocks), ...appConfig.sections.map((s) => s.id)]),
]
console.log(`Pulling ${feedIds.length} feeds...`)
const { candidates, feedErrors } = await pullSupply({ feedIds })
for (const fe of feedErrors || []) console.log(`  ⚠ feed ${fe.feedId}: ${fe.error}`)

const seen = new Set()
const deduped = candidates.filter((c) => {
  if (!c.url || seen.has(c.url)) return false
  seen.add(c.url)
  return true
})
const { unique } = await filterDuplicates({ candidates: deduped })

const byFeed = new Map()
for (const c of unique) {
  if (!byFeed.has(c.feedId)) byFeed.set(c.feedId, [])
  byFeed.get(c.feedId).push(c)
}
const feeds = feedIds.map((fid) => {
  const items = byFeed.get(fid) || []
  const dest = blocksForFeed(fid, blocks)[0] || null
  items.sort((a, z) => new Date(z.pubDate || 0) - new Date(a.pubDate || 0))
  return {
    feedId: fid,
    feedName: appConfig.getSection(fid)?.name || fid,
    front: dest?.front || null,
    blockLabel: dest?.label || null,
    items: items.map((c) => ({ url: c.url, title: c.title, image: c.image, pubDate: c.pubDate })),
  }
})

const total = feeds.reduce((s, f) => s + f.items.length, 0)
console.log(`${total} fresh title(s) across ${feeds.length} table(s) (pulled ${candidates.length}, new ${unique.length})`)
if (!total) process.exit(0)

// ── Demand (advisory) ─────────────────────────────────────────────────────────
let demand = []
try {
  demand = await computeDemand()
} catch (err) {
  console.log(`  ⚠ demand failed (selection runs without it): ${err.message}`)
}

// ── Claude proposes (block-fed news only; recurring tables are manual-pick) ──
const proposable = feeds.filter((f) => f.front && f.items.length)
console.log(`\nAsking Claude to propose (model ${SELECT_MODEL})...`)
const t0 = Date.now()
const { picks, model, error } = await selectCandidates({ feeds: proposable, demand })
console.log(`→ ${picks.size} pick(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s${error ? `  (ERROR: ${error})` : ''}`)

const needByFront = new Map(demand.map((d) => [d.front, d]))
let picked = 0
for (const f of feeds) {
  const d = needByFront.get(f.front)
  const needTxt = d ? (d.need > 0 ? `necesita ${d.need}` : d.stale ? 'lleno pero viejo' : 'lleno y fresco') : 's/d'
  const destTxt = f.blockLabel ? `→ ${f.blockLabel} (${needTxt})` : '(sección propia, sin Claude — elegir a mano)'
  console.log(`\n${'═'.repeat(72)}\n  ${f.feedName}  ${destTxt}\n${'═'.repeat(72)}`)
  if (!f.items.length) console.log('  (sin títulos nuevos)')
  for (const it of f.items) {
    const p = picks.get(it.url)
    if (p) {
      picked += 1
      console.log(`  ✅ [${String(p.score).padStart(3)}] ${snip(it.title, 80)}`)
      console.log(`         🤖 ${p.reason}`)
    } else {
      console.log(`  ·        ${snip(it.title, 80)}`)
    }
  }
}

console.log(`\n${'─'.repeat(72)}`)
console.log(`TOTAL: Claude picked ${picked}/${total} · model ${model}${error ? ` · error: ${error}` : ''}`)
console.log('(dry run — nothing written to Airtable or PostHog)')
