// ── Supabase sections: the canonical taxonomy ────────────────────────────────
//
// The single source of truth for ALL Supabase sections (the ~50 section pages
// the frontend renders). Pulled verbatim from the live `sections` table on
// 2026-07-07 — id, display name, and parent (the table is hierarchical:
// e.g. dolar/propiedades/tecnologia hang off economia).
//
// Consumers:
//   - the admin picker's section dropdown ("Todas" group = this list)
//   - section-routing.js menus are validated against these ids
//   - anywhere a section id needs its display name (or vice versa)
//
// NOTE: 'primera-plana' is deliberately NOT here — it is not a row in the
// Supabase sections table. It survives only as publishArticle's legacy default
// for blank sections (and as an Airtable TABLE name). Don't add it.
//
// If a section is added/renamed in Supabase, update this list to match.

export const SECTIONS = [
  { id: 'actualidad', name: 'Actualidad', parent: null },
  { id: 'agricultura', name: 'Agricultura', parent: 'agro' },
  { id: 'agro', name: 'Agro', parent: null },
  { id: 'ambiente', name: 'Ambiente', parent: 'sociedad' },
  { id: 'campos', name: 'Campos', parent: 'propiedades' },
  { id: 'ciencia', name: 'Ciencia', parent: 'sociedad' },
  { id: 'cine-series', name: 'Cine y Series', parent: 'cultura' },
  { id: 'clima', name: 'Clima', parent: null },
  { id: 'construccion-diseno', name: 'Construcción y Diseño', parent: 'propiedades' },
  { id: 'coronel-suarez', name: 'Coronel Suárez', parent: null },
  { id: 'cultura', name: 'Cultura', parent: null },
  { id: 'deportes', name: 'Deportes', parent: null },
  { id: 'dolar', name: 'Dólar', parent: 'economia' },
  { id: 'economia', name: 'Economía', parent: null },
  { id: 'educacion', name: 'Educación', parent: 'sociedad' },
  { id: 'efemerides', name: 'Efemérides', parent: 'sociedad' },
  { id: 'el-recetario', name: 'El Recetario', parent: null },
  { id: 'espectaculos', name: 'Espectáculos', parent: null },
  { id: 'feriados', name: 'Feriados', parent: 'lifestyle' },
  { id: 'fitness', name: 'Fitness', parent: 'salud' },
  { id: 'ganaderia', name: 'Ganadería', parent: 'agro' },
  { id: 'historia-literatura', name: 'Historia y Literatura', parent: 'cultura' },
  { id: 'horoscopo', name: 'Horóscopo', parent: 'lifestyle' },
  { id: 'huanguelen', name: 'Huanguelén', parent: null },
  { id: 'iactualidad', name: 'IActualidad', parent: 'economia' },
  { id: 'inmuebles', name: 'Inmuebles', parent: 'propiedades' },
  { id: 'la-sexta', name: 'La Sexta', parent: null },
  { id: 'lifestyle', name: 'Lifestyle', parent: null },
  { id: 'loterias-quinielas', name: 'Loterías y Quinielas', parent: 'lifestyle' },
  { id: 'mascotas', name: 'Mascotas', parent: 'lifestyle' },
  { id: 'moda-belleza', name: 'Moda y Belleza', parent: 'lifestyle' },
  { id: 'mundo', name: 'Mundo', parent: null },
  { id: 'nutricion-energia', name: 'Nutrición y energía', parent: 'salud' },
  { id: 'opinion', name: 'Opinión', parent: null },
  { id: 'policiales', name: 'Policiales', parent: 'sociedad' },
  { id: 'politica', name: 'Política', parent: null },
  { id: 'propiedades', name: 'Propiedades', parent: 'economia' },
  { id: 'pueblos-alemanes', name: 'Pueblos Alemanes', parent: null },
  { id: 'pymes-emprendimientos', name: 'Pymes y Emprendimientos', parent: null },
  { id: 'salud', name: 'Salud', parent: null },
  { id: 'salud-mental', name: 'Salud mental', parent: 'salud' },
  { id: 'san-jose', name: 'San José', parent: 'pueblos-alemanes' },
  { id: 'santa-maria', name: 'Santa María', parent: 'pueblos-alemanes' },
  { id: 'santa-trinidad', name: 'Santa Trinidad', parent: 'pueblos-alemanes' },
  { id: 'sociedad', name: 'Sociedad', parent: null },
  { id: 'tecnologia', name: 'Tecnología', parent: 'economia' },
  { id: 'tecnologias-agro', name: 'Tecnologías', parent: 'agro' },
  { id: 'turismo', name: 'Turismo', parent: 'lifestyle' },
  { id: 'vida-armonia', name: 'Vida en Armonía', parent: 'salud' },
  { id: 'vinos', name: 'Vinos', parent: null },
]

const byId = new Map(SECTIONS.map((s) => [s.id, s]))

export function getSection(id) {
  return byId.get(id) || null
}

export function sectionName(id) {
  return byId.get(id)?.name || id
}

export function isValidSection(id) {
  return byId.has(id)
}

// Airtable stores the display name ("Deportes"); the pipeline works in ids
// ("deportes"). Normalize either form (or a hand-typed variant) back to the id
// so analytics/metrics slice on one consistent value. Unknown values pass
// through unchanged rather than being dropped.
const byName = new Map(SECTIONS.map((s) => [s.name, s.id]))

export function sectionIdFromAirtable(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (byId.has(raw)) return raw
  if (byName.has(raw)) return byName.get(raw)
  const slug = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return byId.has(slug) ? slug : raw
}

export default SECTIONS
