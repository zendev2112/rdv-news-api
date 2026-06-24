// ── Homepage blocks: the curation agent's single source of truth ──────────
//
// `front`        — the React component / Supabase `front` value the block reads.
// `slots`        — real visual slots the component renders (see coverage.js).
// `layer`        — 1 = manual/curated (propose only, never cron-auto),
//                  2 = auto-eligible.
// `requiresImage`— block needs a usable image (homepage hero/cards).
// `manualOnly`   — has no RSS feed → can't be auto-fed.
// `hidden`       — not currently rendered on the homepage.
// `eligibleFeeds`— config section ids whose items may fill this block. Inverted
//                  from editorial-structure-RDV.md (the Airtable→Frontend table).
//
// A candidate from feed F may be assigned to block B only if F ∈ B.eligibleFeeds.
// The item's feed id doubles as the Airtable section id for generation (the
// table it came from); `front` is the homepage destination — two different things.

export const HOMEPAGE_BLOCKS = [
  // ── Layer 1: curated locals (propose, human approves) ──────────────────
  { front: 'PrincipalSection',          label: 'Principal',            slots: 6,  layer: 1, requiresImage: true,  eligibleFeeds: ['instituciones', 'local', 'local-facebook'] },
  { front: 'NoticiasImportantesSection', label: 'Noticias Importantes', slots: 4,  layer: 1, requiresImage: true,  eligibleFeeds: ['instituciones', 'local', 'local-facebook'] },
  { front: 'PueblosAlemanesSection',    label: 'Pueblos Alemanes',     slots: 4,  layer: 1, requiresImage: true,  eligibleFeeds: ['pueblos-alemanes', 'instituciones', 'local'] },
  { front: 'HuanguelenSection',         label: 'Huanguelén',           slots: 3,  layer: 1, requiresImage: true,  eligibleFeeds: ['huanguelen'] },
  { front: 'LaSextaSection',            label: 'La Sexta',             slots: 8,  layer: 1, requiresImage: true,  eligibleFeeds: ['la-sexta'] },

  // ── Layer 2: auto-eligible ─────────────────────────────────────────────
  { front: 'ActualidadSection',         label: 'Actualidad',           slots: 13, layer: 2, requiresImage: true,  eligibleFeeds: ['primera-plana', 'instituciones', 'local', 'local-facebook'] },
  { front: 'PoliticaYEconomiaSection',  label: 'Política y Economía',  slots: 8,  layer: 2, requiresImage: true,  eligibleFeeds: ['primera-plana', 'politica', 'economia'] },
  { front: 'DeportesSection',           label: 'Deportes',             slots: 5,  layer: 2, requiresImage: true,  eligibleFeeds: ['deportes', 'deporte-local-regional'] },
  { front: 'MundoSection',              label: 'Mundo',                slots: 4,  layer: 2, requiresImage: true,  eligibleFeeds: ['mundo'] },
  { front: 'MasNoticiasSection',        label: 'Más Noticias',         slots: 12, layer: 2, requiresImage: false, eligibleFeeds: ['turismo', 'vinos', 'autos'] },
  { front: 'AgroSection',               label: 'Agro',                 slots: 4,  layer: 2, requiresImage: true,  eligibleFeeds: ['agro'] },
  { front: 'EnFocoSection',             label: 'En Foco',              slots: 8,  layer: 2, requiresImage: true,  eligibleFeeds: ['historia-literatura', 'cine-series', 'cultura', 'espectaculos'] },
  { front: 'RecetasSection',            label: 'Recetas',              slots: 3,  layer: 2, requiresImage: true,  eligibleFeeds: ['recetas', 'lifestyle', 'salud'] },
  { front: 'TendenciasSection',         label: 'Tendencias',           slots: 3,  layer: 2, requiresImage: true,  eligibleFeeds: ['espectaculos', 'primera-plana'] },
  { front: 'IActualidadSection',        label: 'IActualidad',          slots: 4,  layer: 2, requiresImage: true,  eligibleFeeds: ['tecnologia'] },
  { front: 'TechSection',               label: 'Tech',                 slots: 3,  layer: 2, requiresImage: true,  eligibleFeeds: ['tecnologia'] },
  { front: 'EspectaculosSection',       label: 'Espectáculos',         slots: 3,  layer: 2, requiresImage: true,  eligibleFeeds: ['espectaculos'] },
  { front: 'InversionesSection',        label: 'Inversiones',          slots: 2,  layer: 2, requiresImage: true,  eligibleFeeds: ['economia'] },
  { front: 'LifestyleSection',          label: 'Lifestyle',            slots: 4,  layer: 2, requiresImage: true,  eligibleFeeds: ['lifestyle', 'turismo', 'salud', 'vinos'] },
  { front: 'BienestarSection',          label: 'Bienestar',            slots: 5,  layer: 2, requiresImage: true,  eligibleFeeds: ['salud'] },
  { front: 'EstrenosSection',           label: 'Estrenos',             slots: 3,  layer: 2, requiresImage: true,  eligibleFeeds: ['cine-series', 'espectaculos'] },

  // ── No RSS feed → cannot be auto-fed ───────────────────────────────────
  { front: 'PymesYEmprendimientosSection', label: 'Pymes y Emprendimientos', slots: 2, layer: 2, requiresImage: true, manualOnly: true, eligibleFeeds: [] },
  { front: 'PropiedadesSection',        label: 'Propiedades',          slots: 4,  layer: 2, requiresImage: true, manualOnly: true, hidden: true, eligibleFeeds: [] },
]

// Recurring / templated feeds handled by their own crons (dollar, quiniela,
// horóscopo, efemérides, clima). The curation agent must NOT touch these.
export const RECURRING_FEEDS = ['quiniela', 'horoscopo', 'efemerides', 'clima']

// ── Tunables ───────────────────────────────────────────────────────────────
export const STALE_HOURS = 48          // a block is "stale" if its newest slotted article is older than this
export const SUPPLY_FRESHNESS_HOURS = 72 // drop RSS items older than this (news decays)
// RSS summaries are teasers (~150 chars), not article bodies — this only drops
// empty/near-empty stubs. True article-length sufficiency is gated later by
// processArticleFromUrl (returns null) after the page is scraped at generation.
export const MIN_CONTENT_CHARS = 80
export const MIN_SCORE = 60            // quality floor: below this, leave the slot empty
export const DEFAULT_MAX_PER_RUN = 20  // cap drafts proposed per run (cold-start ramp)
export const CANDIDATES_PER_FEED = 5   // freshest-N per feed sent to the scorer (keeps the prompt small)

// ── Helpers ─────────────────────────────────────────────────────────────────

// Blocks the agent may consider (excludes hidden + manualOnly + no feeds).
export function autoFeedableBlocks() {
  return HOMEPAGE_BLOCKS.filter(
    (b) => !b.hidden && !b.manualOnly && b.eligibleFeeds.length > 0,
  )
}

// Union of feed ids needed to fill the given blocks, minus recurring feeds.
export function feedsForBlocks(blocks) {
  const set = new Set()
  for (const b of blocks) {
    for (const f of b.eligibleFeeds) {
      if (!RECURRING_FEEDS.includes(f)) set.add(f)
    }
  }
  return [...set]
}

// Which feedable blocks is a given feed eligible to fill?
export function blocksForFeed(feedId, blocks = autoFeedableBlocks()) {
  return blocks.filter((b) => b.eligibleFeeds.includes(feedId))
}

export function getBlock(front) {
  return HOMEPAGE_BLOCKS.find((b) => b.front === front) || null
}
