/**
 * Source registry — classifies WHERE a scraped article came from, which drives:
 *   - naming         (institutions MAY be named; otros medios are COMPETITORS —
 *                     for their REGULAR notes report the public fact as our own
 *                     WITHOUT naming them, but for their INTERVIEWS we extract the
 *                     fact and MUST attribute the interview to the source)
 *   - image rights   (institutional photos OK; otros medios → flyers only)
 *   - sourcing flags (don't lift another medio's interview Q&A → fact-brief instead)
 *   - selection      (knowing it's institutional vs medio shapes relevance)
 *
 * Two source kinds:
 *   - 'institutional' — municipio, clubes, asociaciones, bibliotecas. Their own
 *                       images/info are usable and they may be named in the text
 *                       ("El Municipio informó…"). imagePolicy 'all'.
 *   - 'medio'         — otros medios locales (radios, diarios, páginas de
 *                       noticias). DIRECT COMPETITORS: for a regular note, rewrite
 *                       the public fact as our own and DO NOT name them; for an
 *                       interview, extract the fact, drop the Q&A, and attribute the
 *                       interview to the source. Never lift their photos (flyers
 *                       excepted). imagePolicy 'flyers-only'.
 *
 * Most sources share facebook.com / instagram.com hosts, so `match` tokens are
 * page slugs, profile ids, handles, or bare domains — matched as substrings of
 * the full URL. When a post URL is opaque (e.g. instagram.com/p/XXXX), we fall
 * back to the feed's default kind via `feedDefaults`.
 */

// imagePolicy: 'all' (any institutional image) | 'flyers-only' (only afiches/gráficas)
const INSTITUTIONAL = { type: 'institutional', imagePolicy: 'all', requireAttribution: false }
const MEDIO = { type: 'medio', imagePolicy: 'flyers-only', requireAttribution: true }

export const sources = [
  // ── Otros medios locales (usar como fuente; fotos propias prohibidas) ──────
  { id: 'la-nueva-radio-suarez', name: 'La Nueva Radio Suárez', ...MEDIO,
    match: ['lanuevaradiosuarez'] },
  { id: 'radio-ciudad-noticias', name: 'Radio Ciudad Noticias', ...MEDIO,
    match: ['radiociudadnoticias'] },
  { id: 'radio-coronel-suarez', name: 'Radio Coronel Suárez', ...MEDIO,
    match: ['radiocoronelsuarez'] },
  { id: 'suarez-al-dia', name: 'Suárez al Día', ...MEDIO,
    match: ['suarezaldia'] },
  { id: 'coronelsuarez-post', name: 'CoronelSuárez Post', ...MEDIO,
    match: ['postcoronelsuarez'] },

  // ── Instituciones (imágenes propias permitidas) ───────────────────────────
  { id: 'municipio-coronel-suarez', name: 'Municipio de Coronel Suárez', ...INSTITUTIONAL,
    aliases: ['el municipio', 'la comuna', 'municipalidad'],
    match: ['suarezmunicipio'] },
  { id: 'biblioteca-sarmiento', name: 'Biblioteca Popular Sarmiento', ...INSTITUTIONAL,
    aliases: ['la biblioteca', 'biblioteca sarmiento'],
    match: ['100068350193742'] },
  { id: 'tiro-federal', name: 'Tiro Federal Villa Belgrano', ...INSTITUTIONAL,
    match: ['tirofederalvillabelgrano'] },
  { id: 'boca-juniors-cs', name: 'Club Atlético Boca Juniors Coronel Suárez', ...INSTITUTIONAL,
    aliases: ['boca de suárez'],
    match: ['100064649354117'] },
  { id: 'voleibol-sudoeste', name: 'Asociación de Voleibol del Sudoeste', ...INSTITUTIONAL,
    aliases: ['voleibol del sudoeste'],
    match: ['voleibol_del_sudoeste'] },
  { id: 'basquet-sudoeste', name: 'Básquet Asociado Sudoeste', ...INSTITUTIONAL,
    aliases: ['básquet del sudoeste'],
    match: ['basquetsudoeste'] },
  { id: 'cefm', name: 'CEFM', ...INSTITUTIONAL,
    match: ['_cefm_'] },
  { id: 'centro-blanco-y-negro', name: 'Centro Blanco y Negro de Coronel Suárez', ...INSTITUTIONAL,
    aliases: ['albinegro', 'decano', 'blanco y negro'],
    match: ['centroblancoynegro_cs', 'centroblancoynegro'] },
  { id: 'centro-deportivo-sarmiento', name: 'Centro Deportivo Sarmiento', ...INSTITUTIONAL,
    aliases: ['verdirrojo'],
    match: ['verdirrojo'] },
]

// Per-feed default when the article URL can't be matched to a specific source
// (e.g. opaque instagram.com/p/XXXX permalinks). Your Airtable tables already
// sort by source kind, so the feed is a reliable fallback.
export const feedDefaults = {
  instituciones: INSTITUTIONAL,
  'deporte-local-regional': INSTITUTIONAL,
  local: MEDIO,
  'local-facebook': MEDIO,
}

const DEFAULT = { id: 'unknown', name: 'Desconocido', type: 'unknown', imagePolicy: 'flyers-only', requireAttribution: true }

/**
 * Classify a scraped article by URL, falling back to its feed.
 * @param {string} url
 * @param {string} [feedId]
 * @returns {{id,name,type,imagePolicy,requireAttribution,aliases?}}
 */
export function classifySource(url, feedId) {
  const full = String(url || '').toLowerCase()
  if (full) {
    for (const s of sources) {
      if (s.match.some((tok) => full.includes(tok.toLowerCase()))) return s
    }
  }
  if (feedId && feedDefaults[feedId]) {
    return { id: `feed:${feedId}`, name: feedId, ...feedDefaults[feedId] }
  }
  return DEFAULT
}

/**
 * Decide whether a given image may be used.
 * isFlyer comes from the vision check (flyer/afiche vs. fotografía); until that
 * runs it's undefined → treat a flyers-only source's image as "needs review".
 * @returns {{allowed: boolean|null, reason: string}}
 */
export function imageDecision(source, isFlyer) {
  if (source.imagePolicy === 'all') return { allowed: true, reason: 'institucional' }
  // flyers-only
  if (isFlyer === true) return { allowed: true, reason: 'flyer' }
  if (isFlyer === false) return { allowed: false, reason: `foto propia (${source.name})` }
  return { allowed: null, reason: `verificar flyer vs foto (${source.name})` }
}

export default { sources, feedDefaults, classifySource, imageDecision }
