// ── Section & block routing: the single source of truth for placement ────────
//
// How a scraped article reaches the reader has two placement labels:
//   - section : which Supabase SECTION page(s) it may belong to (the taxonomy,
//               drives /economia, /salud/fitness, … and the section components)
//   - block   : which homepage BOX(es) it may fill (`front` ids in
//               homepage-blocks.js — Principal, Actualidad, Inversiones, …)
//
// This map is keyed by feedId (= the Airtable table = a config section id) and,
// for each, lists the SHORT allowed section menu Claude may choose from (reading
// the headline) and the homepage boxes that table may fill. It replaces the old
// implicit "first eligible block" rule in buildTitleList that starved the
// secondary boxes of wide tables (economia → only Política y Economía, never
// Inversiones, etc.).
//
// CONVENTIONS
//   - `sections[0]` is the DEFAULT/fallback section (used when Claude is unsure).
//   - `blocks` are homepage `front` ids; order is preference, not exclusivity.
//   - tier lives in day-sheet.js (tier + daily quota) — NOT duplicated here.
//
// Locked with the editor 2026-07-06 (see memory: section-block-routing).
// STAGING: this is data only. Nothing imports it yet. The next step refactors
// homepage-blocks `eligibleFeeds`, the day sheet, and select.js to DERIVE from
// this file so there is one map instead of three.

export const SECTION_ROUTING = {
  // ── Local tables ──────────────────────────────────────────────────────────
  instituciones: {
    sections: ['coronel-suarez', 'actualidad', 'policiales', 'educacion'],
    blocks: ['PrincipalSection', 'NoticiasImportantesSection', 'PueblosAlemanesSection', 'ActualidadSection'],
  },
  local: {
    sections: ['coronel-suarez', 'actualidad', 'policiales'],
    blocks: ['PrincipalSection', 'NoticiasImportantesSection', 'PueblosAlemanesSection', 'ActualidadSection'],
  },
  'local-facebook': {
    sections: ['coronel-suarez', 'actualidad', 'policiales'],
    blocks: ['PrincipalSection', 'NoticiasImportantesSection', 'ActualidadSection'],
  },
  'pueblos-alemanes': {
    sections: ['pueblos-alemanes', 'santa-trinidad', 'san-jose', 'santa-maria'],
    blocks: ['PueblosAlemanesSection'],
  },
  huanguelen: {
    sections: ['huanguelen'],
    blocks: ['HuanguelenSection'],
  },
  'la-sexta': {
    sections: ['la-sexta'],
    blocks: ['LaSextaSection'],
  },
  'deporte-local-regional': {
    sections: ['deportes'],
    blocks: ['DeportesSection'],
  },

  // ── Secondary tables ──────────────────────────────────────────────────────
  // Primera Plana = general front bucket (tier secondary per editor).
  'primera-plana': {
    sections: ['actualidad', 'coronel-suarez', 'policiales', 'educacion', 'sociedad'],
    blocks: ['ActualidadSection', 'PoliticaYEconomiaSection', 'TendenciasSection'],
  },
  economia: {
    // propiedades/campos/construccion may box to EITHER Inversiones OR Política y
    // Economía; Economía also feeds the Pymes y Emprendimientos and Propiedades
    // boxes (editor 2026-07-06). Autos is folded in → section 'economia'.
    sections: ['economia', 'dolar', 'propiedades', 'campos', 'construccion-diseno', 'inmuebles', 'iactualidad', 'pymes-emprendimientos'],
    blocks: ['PoliticaYEconomiaSection', 'InversionesSection', 'PymesYEmprendimientosSection', 'PropiedadesSection'],
  },
  autos: {
    // Folded into Economía: no 'autos' Supabase section exists → section 'economia'.
    sections: ['economia'],
    blocks: ['MasNoticiasSection'],
  },
  politica: {
    sections: ['politica'],
    blocks: ['PoliticaYEconomiaSection'],
  },
  deportes: {
    sections: ['deportes'],
    blocks: ['DeportesSection'],
  },
  mundo: {
    sections: ['mundo', 'ambiente'],
    blocks: ['MundoSection'],
  },
  agro: {
    sections: ['agro', 'ganaderia', 'agricultura', 'tecnologias-agro'],
    blocks: ['AgroSection'],
  },
  turismo: {
    sections: ['turismo'],
    blocks: ['MasNoticiasSection', 'LifestyleSection'],
  },
  vinos: {
    sections: ['vinos'],
    blocks: ['MasNoticiasSection', 'LifestyleSection'],
  },
  lifestyle: {
    sections: ['lifestyle', 'feriados', 'fitness', 'mascotas', 'moda-belleza', 'nutricion-energia', 'vida-armonia'],
    blocks: ['RecetasSection', 'LifestyleSection'],
  },
  salud: {
    sections: ['salud', 'fitness', 'nutricion-energia', 'salud-mental', 'vida-armonia'],
    blocks: ['RecetasSection', 'LifestyleSection', 'BienestarSection'],
  },
  recetas: {
    sections: ['el-recetario'], // name mismatch kept intentionally (table Recetas → section El Recetario)
    blocks: ['RecetasSection'],
  },
  cultura: {
    sections: ['cultura'],
    blocks: ['EnFocoSection'],
  },
  'cine-series': {
    sections: ['cine-series'],
    blocks: ['EnFocoSection', 'EstrenosSection'],
  },
  'historia-literatura': {
    sections: ['historia-literatura'],
    blocks: ['EnFocoSection'],
  },
  espectaculos: {
    sections: ['espectaculos'],
    blocks: ['EnFocoSection', 'TendenciasSection', 'EspectaculosSection', 'EstrenosSection'],
  },
  tecnologia: {
    sections: ['tecnologia', 'iactualidad'],
    blocks: ['IActualidadSection', 'TechSection'],
  },

  // ── Recurring tables (guaranteed daily; no Claude section judgment) ─────────
  quiniela: {
    sections: ['loterias-quinielas'],
    blocks: ['MasNoticiasSection'],
  },
  horoscopo: {
    sections: ['horoscopo'],
    blocks: ['MasNoticiasSection'],
  },
  efemerides: {
    sections: ['efemerides'],
    blocks: ['ActualidadSection', 'MasNoticiasSection'],
  },
  clima: {
    sections: ['clima'],
    blocks: ['PrincipalSection', 'ActualidadSection'],
  },
}

// The Supabase section id an article defaults to when Claude gives no (or an
// invalid) section — the first entry of the table's menu.
export function defaultSectionFor(feedId) {
  return SECTION_ROUTING[feedId]?.sections?.[0] || null
}

// The allowed Supabase section menu for a table (what Claude may choose from).
export function sectionMenuFor(feedId) {
  return SECTION_ROUTING[feedId]?.sections || []
}

// The homepage boxes (front ids) a table may fill.
export function blocksFor(feedId) {
  return SECTION_ROUTING[feedId]?.blocks || []
}

export default SECTION_ROUTING
