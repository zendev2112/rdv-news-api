/**
 * Shared article processing pipeline.
 *
 * Single entry point for turning a URL (or pre-fetched text) into a
 * fully-processed article record with metadata, tags, embeds, and images.
 *
 * Used by:
 *   - fetch-to-airtable.js  (RSS pipeline)
 *   - api/slack/process.js   (Slack slash command)
 *   - src/routes/slack-integration.js (Express fallback)
 */

import { generateContent, classifyImageForUse } from './ai-service.js'
import * as cheerio from 'cheerio'
import {
  fetchContent,
  extractText,
  extractImagesAsMarkdown,
} from './scraper.js'
import {
  reelaborateArticle,
  extractFactsBrief,
  reelaborateSocialMedia,
  generateMetadata as generateMetadataPrompt,
  generateSocialMediaMetadata as generateSocialMediaMetadataPrompt,
  generateTags as generateTagsPrompt,
} from '../prompts/index.js'
import {
  extractInstagramEmbeds,
  extractFacebookEmbeds,
  extractTwitterEmbeds,
  extractYoutubeEmbeds,
} from './embeds/index.js'
import { enforceRioplatense } from '../utils/rioplatense.js'
import { classifySource, imageDecision, sources as registrySources } from '../config/source-registry.js'
import { detectInterview } from './curation/content-type.js'

// ── Utility functions ────────────────────────────────────────────────

const PROPER_NOUNS = [
  'Argentina',
  'Buenos Aires',
  'Coronel Suárez',
  'Suárez',
  'Sarmiento',
  'Huanguelén',
  'Pueblos Alemanes',
  'Santa Trinidad',
  'Villa Belgrano',
  'Facebook',
  'Instagram',
  'Twitter',
  'YouTube',
  'COVID',
  'AFA',
  'FIFA',
  'NBA',
  'ATP',
  'WTA',
]

// Sentence-case helper. CRITICAL: it must NOT lowercase proper nouns the model
// already capitalized ("Suárez", "Sarmiento"). So we TRUST the model's casing and
// only intervene on a pathological ALL-CAPS string (rare). The previous version
// force-lowercased every non-first word, turning "Ambiente Suárez" → "Ambiente
// suárez" — the bug this fixes.
export function toSentenceCase(text) {
  if (!text) return ''
  const trimmed = text.trim()
  const letters = trimmed.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '')
  const isAllCaps = letters.length > 1 && letters === letters.toUpperCase()
  const base = isAllCaps ? trimmed.toLowerCase() : trimmed
  return base
    .split(/\s+/)
    .map((word, i) => {
      const proper = PROPER_NOUNS.find(
        (n) => word.toLowerCase() === n.toLowerCase(),
      )
      if (proper) return proper
      // Capitalize the first word if the model left it lowercase; otherwise keep
      // the model's casing verbatim (preserves proper nouns mid-sentence).
      if (i === 0 && /^[a-záéíóúüñ]/.test(word))
        return word.charAt(0).toUpperCase() + word.slice(1)
      return word
    })
    .join(' ')
}

// Proper-noun map (lowercase form → canonical casing) for sentence-case
// enforcement. Built from the base list above + the source registry (local
// institutions/medios and their significant name tokens), so local names like
// "Sarmiento", "Centro Deportivo Sarmiento", "Coronel Suárez" keep their capitals
// while ordinary words get lowercased.
const PROPER_NOUN_MAP = (() => {
  const map = new Map()
  const minor = /^(de|del|la|el|los|las|y|e|o|u|en|a|con|por|para|un|una)$/i
  const add = (phrase) => {
    if (phrase && phrase.length > 1) map.set(phrase.toLowerCase(), phrase)
  }
  for (const p of PROPER_NOUNS) add(p)
  for (const extra of [
    'San Martín', 'El Progreso', 'Santa Trinidad', 'Villa Belgrano',
    'Estudiantes', 'Ferroviario', 'Mitre',
  ]) add(extra)
  for (const s of registrySources || []) {
    add(s.name)
    for (const tok of String(s.name || '').split(/\s+/)) {
      if (/^[A-ZÁÉÍÓÚÑ]/.test(tok) && tok.length > 2 && !minor.test(tok)) add(tok)
    }
  }
  return map
})()

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Spanish common/function words + high-frequency local-news vocabulary. These are
// the words that get wrongly capitalized in Title Case ("Resultados De La Décima
// Fecha"). We lowercase THESE and PRESERVE everything else — because an unknown
// capitalized word (a surname, a place: "Vergara", "Puente Chico") is far more
// likely a proper noun than a stray Title-Cased common word. NOTE: deliberately
// EXCLUDES words that double as proper-noun tokens (san, santa, chico, mitre…).
const COMMON_WORDS = new Set([
  // articles, prepositions, conjunctions, pronouns, common adverbs
  'de','del','la','el','los','las','un','una','unos','unas','lo','al',
  'y','e','o','u','ni','que','se','su','sus','le','les','me','te','nos',
  'en','a','con','sin','sobre','entre','hasta','desde','tras','ante','bajo',
  'por','para','según','durante','contra','hacia','mediante',
  'más','menos','muy','ya','no','sí','también','tras','como','cuando','donde',
  'este','esta','estos','estas','ese','esa','esos','esas','aquel','esto','eso',
  'cada','todo','toda','todos','todas','otro','otra','otros','otras','mismo','misma',
  'quien','quienes','cual','cuales','cuyo','cuya','cuánto','cómo','cuándo','dónde','qué',
  // common verbs (frequent forms)
  'es','son','fue','fueron','será','serán','está','están','estará','estarán','estuvo',
  'hay','había','habrá','ha','han','he','hemos','tiene','tienen','tuvo','tendrá',
  'realizó','realizará','realizaron','realiza','llevó','llevará','participó','participará',
  'destacó','destaca','anunció','anunciará','abre','abren','presentó','presentará','presenta',
  'busca','buscan','ofrece','ofrecen','celebra','celebró','celebrará','invita','invitan',
  'comenzó','comienza','continúa','sigue','siguen','dio','dieron','logró','lograron','viene',
  'prepara','preparan','organiza','organizó','recibió','recibirá','sumó','sumará',
  'juega','juegan','jugará','jugaron','jugó','gana','ganó','ganará','ganaron',
  'pierde','perdió','enfrenta','enfrentará','enfrentó','disputa','disputó','disputará',
  'visita','visitará','visitó','clasifica','clasificó','clasificaron','vence','venció',
  'cayó','avanza','avanzó','quedó','asume','asumirá','asumió','fortalece','impulsa',
  // ordinals (lowercase in sentence case: "la décima fecha", "los cuartos")
  'primera','primero','segunda','segundo','tercera','tercero','cuarta','cuarto',
  'quinta','quinto','sexta','sexto','séptima','séptimo','octava','octavo',
  'novena','noveno','décima','décimo','undécima','duodécima',
  // high-frequency local-news nouns/adjectives
  'día','días','fecha','fechas','año','años','mes','meses','semana','hora','horas',
  'jornada','jornadas','actividad','actividades','evento','eventos','acto','actos',
  'encuentro','reunión','reuniones','partido','partidos',
  // NOTE: torneo/copa/liga/apertura omitted on purpose — they usually head proper
  // event names ("Copa Orlando", "Torneo Apertura"), so we defer to the model.
  'final','finales','semifinal','semifinales','cuartos','octavos','fase','ronda',
  'resultado','resultados','triunfo','victoria','derrota','empate','puntos',
  'aniversario','historia','trayectoria','compromiso','vocación','pasión','futuro',
  'comunidad','vecinos','vecinas','ciudad','distrito','pueblo','barrio','localidad',
  'calle','avenida','plaza','salón','sede','edificio','gimnasio','estadio','instalaciones',
  // NOTE: institution-structure headwords (escuela, colegio, club, centro,
  // consejo, dirección, secretaría, hospital, instituto, biblioteca…) are OMITTED
  // on purpose — they head unregistered proper names ("Consejo de Personas
  // Mayores", "Centro de Formación Laboral"), so we defer to the model's casing.
  // Registered institutions are handled by the proper-noun phrase map.
  'salud','educación','deporte','deportes','cultura','ambiente','turismo',
  'fútbol','vóley','voleibol','básquet','básquetbol','patín','patinaje','natación',
  'equipo','equipos','plantel','categoría','categorías','división','divisiones',
  'reserva','inferiores','formativas','cadetes','juvenil',
  'femenino','femenina','masculino','masculina','infantil',
  'show','espectáculo','festival','muestra','feria','exposición','concierto','función',
  'curso','cursos','taller','talleres','capacitación','formación','inscripción','inscripciones',
  'programa','proyecto','proyectos','iniciativa','propuesta','campaña','obra','obras',
  'servicio','servicios','atención','área','áreas','grupo',
  'municipal','provincial','nacional','regional','local','oficial','general','público','pública',
  'nueva','nuevo','nuevas','nuevos','gran','grandes','primer','primero','segundo','último','última',
  'importante','emotiva','emotivo','especial','solidaria','solidario','integral',
  'jubilación','reconocimiento','homenaje','celebración','conmemoración','festejo',
  'donaciones','ayuda','apoyo','contención','acompañamiento','bienestar',
])

// Recase a single word for Argentine sentence case.
function recaseWord(word) {
  const lower = word.toLowerCase()
  // Known single-token proper noun → canonical casing (e.g. "SARMIENTO" → "Sarmiento").
  if (PROPER_NOUN_MAP.has(lower)) return PROPER_NOUN_MAP.get(lower)
  // Known common/function word → lowercase (this is what kills Title Case).
  if (COMMON_WORDS.has(lower)) return lower
  // Unknown word: PRESERVE its casing (a capital here is almost certainly a proper
  // noun — surname, place, acronym). One exception: a long ALL-CAPS shout that is
  // not a known acronym gets tamed to Title case ("VERDIRROJO" → "Verdirrojo");
  // short all-caps (≤6) are kept as acronyms ("CAPS", "BASO", "CORESA").
  const letters = [...word].filter((c) => /\p{L}/u.test(c))
  const isAllCaps = letters.length > 1 && word === word.toUpperCase()
  if (isAllCaps && letters.length > 6) {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  }
  return word
}

// Enforce Argentine sentence case WITHOUT destroying proper nouns. Instead of
// lowercasing everything (which nuked unknown names like "Vergara"), we recase
// word-by-word: lowercase known common words, keep the model's capitals on
// everything else. Then restore canonical multiword proper nouns and capitalize
// the first letter. "Resultados De La Décima Fecha" → "Resultados de la décima
// fecha"; "Margarita Vergara" and "CAPS Puente Chico" survive intact.
export function enforceSentenceCase(text) {
  if (!text) return text
  let out = text.replace(/\p{L}[\p{L}\p{M}''-]*/gu, (w) => recaseWord(w))
  // Restore canonical multiword proper nouns (longest first so phrases beat tokens).
  const phrases = [...PROPER_NOUN_MAP.keys()]
    .filter((k) => k.includes(' '))
    .sort((a, b) => b.length - a.length)
  for (const ph of phrases) {
    const re = new RegExp(`(^|[^\\p{L}])(${escapeRegExp(ph)})(?![\\p{L}])`, 'giu')
    out = out.replace(re, (m, pre) => pre + PROPER_NOUN_MAP.get(ph))
  }
  // Capitalize the first LETTER, skipping leading punctuation/spaces (e.g. "¿").
  out = out.replace(/^([^\p{L}]*)(\p{Ll})/u, (m, pre, ch) => pre + ch.toUpperCase())
  return out
}

// Force every markdown heading (## / ###) in a body to sentence case.
export function sentenceCaseHeadings(text) {
  if (!text) return text
  return text.replace(
    /^(#{1,6}\s+)(.+)$/gm,
    (m, hashes, heading) => hashes + enforceSentenceCase(heading.trim()),
  )
}

// Heuristic: does this look Title-Cased (most content words capitalized)? Used to
// decide whether to force a title into sentence case without touching titles that
// are already correct (which carry only a few proper-noun capitals).
function looksTitleCased(text) {
  const words = String(text || '').split(/\s+/).filter((w) => /\p{L}/u.test(w))
  if (words.length < 3) return false
  const minor = /^(de|del|la|el|los|las|y|e|o|u|en|a|con|por|para|un|una|que|su|sus|al)$/i
  const content = words.slice(1).filter((w) => !minor.test(w))
  if (content.length < 2) return false
  const capped = content.filter((w) => /^[A-ZÁÉÍÓÚÑ]/.test(w)).length
  return capped / content.length > 0.7
}

export function stripMarkdown(text) {
  if (!text) return ''
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/ {2,}/g, ' ')
    .trim()
}

export function postProcessText(text) {
  if (!text) return ''
  let fixed = text
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
  fixed = fixed.replace(/\n{3,}/g, '\n\n').replace(/\n\s+\n/g, '\n\n')
  fixed = fixed.replace(/^\s*-\s+/gm, '- ')
  fixed = fixed.replace(/^\s*(\d+)\.\s+/gm, '$1. ')
  fixed = fixed.replace(/^#+\s+/gm, '## ')
  fixed = sentenceCaseHeadings(fixed) // subtitles in sentence case, never Title Case
  fixed = fixed.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  fixed = fixed.replace(/\t/g, ' ')
  fixed = fixed.replace(/ {2,}/g, ' ')
  fixed = fixed.trim()
  fixed = fixed.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'")
  fixed = enforceRioplatense(fixed)
  return fixed
}

// Broad emoji/pictograph coverage. Deliberately excludes the  -⁯ block
// (it holds the em dash — and real punctuation we must keep).
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2122}\u{2139}\u{20E3}\u{FE00}-\u{FE0F}\u{200D}]/gu

// Strip every emoji/pictograph and tidy the whitespace they leave behind.
function stripEmojis(text) {
  if (!text) return text
  return text
    .replace(EMOJI_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

/**
 * Extract the main image from HTML meta tags (og:image, twitter:image)
 */
function extractMetaImage(html) {
  try {
    const $ = cheerio.load(html)
    const ogImage =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="og:image"]').attr('content')
    if (ogImage && ogImage.startsWith('http')) return ogImage

    const twitterImage =
      $('meta[name="twitter:image"]').attr('content') ||
      $('meta[property="twitter:image"]').attr('content')
    if (twitterImage && twitterImage.startsWith('http')) return twitterImage

    const metaImage = $('meta[itemprop="image"]').attr('content')
    if (metaImage && metaImage.startsWith('http')) return metaImage

    return null
  } catch {
    return null
  }
}

/**
 * Extract large article images from HTML (not just captioned ones).
 * Complements extractImagesAsMarkdown which only finds captioned images.
 */
function extractArticleImages(html) {
  try {
    const $ = cheerio.load(html)
    const images = []

    // 1. Images inside <figure> (even without figcaption)
    $('figure img').each((i, img) => {
      const src = $(img).attr('src') || $(img).attr('data-src')
      if (src && isValidArticleImage(src) && !images.includes(src)) {
        images.push(src)
      }
    })

    // 2. Images inside article/main content areas
    const contentSelectors =
      'article img, [class*="article"] img, [class*="content"] img, main img, .story img, .post img'
    $(contentSelectors).each((i, img) => {
      const src = $(img).attr('src') || $(img).attr('data-src')
      if (src && isValidArticleImage(src) && !images.includes(src)) {
        // Filter out small images (icons, avatars, etc.)
        const width = parseInt($(img).attr('width') || '0', 10)
        const height = parseInt($(img).attr('height') || '0', 10)
        if ((width > 0 && width < 150) || (height > 0 && height < 150)) return
        images.push(src)
      }
    })

    return images.slice(0, 5) // Max 5 images
  } catch {
    return []
  }
}

function isValidArticleImage(url) {
  if (!url || url.startsWith('data:')) return false
  if (!url.startsWith('http')) return false
  if (url.includes('.svg')) return false
  if (url.includes('ad.') || url.includes('ads.') || url.includes('/ad/'))
    return false
  if (url.includes('pixel.') || url.includes('analytics')) return false
  if (url.includes('/icons/') || url.includes('/social/')) return false
  if (url.includes('tracking') || url.includes('beacon')) return false
  if (url.includes('avatar') || url.includes('logo')) return false
  if (url.includes('emoji') || url.includes('spinner')) return false
  return true
}

/**
 * Fetch oEmbed data for a URL (works for Instagram, Facebook, Twitter, YouTube).
 * These platforms provide oEmbed endpoints that return metadata without scraping.
 */
async function fetchOembedData(url) {
  const oembedEndpoints = [
    {
      match: /instagram\.com/,
      endpoint: `https://api.instagram.com/oembed?url=${encodeURIComponent(url)}`,
    },
    {
      match: /facebook\.com/,
      endpoint: `https://www.facebook.com/plugins/post/oembed.json/?url=${encodeURIComponent(url)}`,
    },
    {
      match: /twitter\.com|x\.com/,
      endpoint: `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}`,
    },
    {
      match: /youtube\.com|youtu\.be/,
      endpoint: `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
    },
  ]

  const matched = oembedEndpoints.find((ep) => ep.match.test(url))
  if (!matched) return null

  try {
    const res = await fetch(matched.endpoint, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

function cleanCodeBlocks(text) {
  return text
    .trim()
    .replace(/^```markdown\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function cleanFillerPhrases(text) {
  return text
    .replace(
      /\b(puntos principales|incluyen los siguientes|a continuación|destacan|cabe mencionar|cabe destacar|es importante mencionar|vale la pena señalar|en este contexto|por su parte|en ese sentido)\b/gi,
      '',
    )
    .replace(
      /\b(en resumen|en conclusión|para finalizar|para concluir|de esta manera)\b/gi,
      '',
    )
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .replace(/ {2,}/g, ' ')
    .trim()
}

export function isSocialMediaUrl(url) {
  try {
    const hostname = new URL(url).hostname
    return (
      hostname.includes('facebook.com') ||
      hostname.includes('instagram.com') ||
      hostname.includes('twitter.com') ||
      hostname.includes('x.com') ||
      hostname.includes('youtube.com') ||
      hostname.includes('youtu.be')
    )
  } catch {
    return false
  }
}

export function getSocialMediaType(url) {
  try {
    const hostname = new URL(url).hostname
    if (hostname.includes('facebook.com')) return 'fb-post'
    if (hostname.includes('instagram.com')) return 'ig-post'
    if (hostname.includes('twitter.com') || hostname.includes('x.com'))
      return 'tw-post'
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be'))
      return 'yt-video'
  } catch {}
  return ''
}

export function extractSourceName(url) {
  try {
    if (!url) return 'Unknown Source'
    const hostname = new URL(url).hostname
    let domain = hostname
      .replace(/^www\./, '')
      .replace(/^m\./, '')
      .replace(/^mobile\./, '')
      .replace(/^news\./, '')
      .replace(/^noticias\./, '')

    if (domain.includes('facebook.com')) return 'Facebook'
    if (domain.includes('instagram.com')) return 'Instagram'
    if (domain.includes('twitter.com') || domain.includes('x.com'))
      return 'Twitter'
    if (domain.includes('youtube.com') || domain.includes('youtu.be'))
      return 'YouTube'
    if (domain.includes('tiktok.com')) return 'TikTok'
    if (domain.includes('linkedin.com')) return 'LinkedIn'
    if (domain.includes('t.co')) return 'Twitter'

    domain = domain.replace(
      /\.(com|co|net|org|info|ar|mx|es|cl|pe|br|uy|py|bo|ec|ve|us|io|tv|app|web|digital|news|online|press|media|blog|site)(\.[a-z]{2,3})?$/,
      '',
    )
    const parts = domain.split('.')
    const sourceName = parts[0]

    const mapping = {
      lanacion: 'La Nación',
      eldiario: 'El Diario',
      pagina12: 'Página 12',
      larazon: 'La Razón',
      lavoz: 'La Voz',
      eleconomista: 'El Economista',
      elpais: 'El País',
      ole: 'Olé',
      ambito: 'Ámbito',
      telam: 'Télam',
      infobae: 'Infobae',
      eldestape: 'El Destape',
      cronista: 'El Cronista',
      tiempoar: 'Tiempo Argentino',
      tn: 'Todo Noticias',
      clarin: 'Clarín',
      lapoliticaonline: 'La Política Online',
    }
    if (mapping[sourceName]) return mapping[sourceName]

    return sourceName
      .split(/[-_]/)
      .map((w) =>
        w.length === 1
          ? w.toUpperCase()
          : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
      )
      .join(' ')
  } catch {
    return 'Unknown Source'
  }
}

// ── Fallback generators ──────────────────────────────────────────────

function generateFallbackMetadata(extractedText) {
  const paragraphs = extractedText
    .split(/\n+/)
    .filter((p) => p.trim().length > 30)
  const firstPara = paragraphs[0] || ''
  const secondPara = paragraphs[1] || ''

  const firstSentence =
    firstPara.split(/[.!?]/)[0]?.trim() || 'Artículo procesado'
  return {
    title: firstSentence.substring(0, 120),
    bajada: secondPara.substring(0, 200) || firstPara.substring(0, 200),
    volanta: 'Noticias',
  }
}

function generateFallbackTags(extractedText, metadata) {
  const text =
    `${metadata?.title || ''} ${metadata?.bajada || ''} ${extractedText}`.toLowerCase()
  const stopwords = [
    'para',
    'como',
    'esta',
    'esto',
    'estos',
    'sobre',
    'desde',
    'entre',
    'hasta',
    'porque',
    'también',
    'pero',
    'tiene',
    'tiene',
    'este',
    'esta',
  ]
  const words = text
    .split(/\W+/)
    .filter((w) => w.length > 3 && !stopwords.includes(w))
  const freq = {}
  words.forEach((w) => {
    freq[w] = (freq[w] || 0) + 1
  })
  const top = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
  if (top.length === 0) return 'Noticias, Actualidad'
  return top.map(([w]) => w.charAt(0).toUpperCase() + w.slice(1)).join(', ')
}

function formatTextAsFallback(text) {
  if (!text) return ''
  let formatted = text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\. /g, '.\n\n')
    .replace(/[#*_`]/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
  const paragraphs = formatted
    .split(/\n+/)
    .filter((p) => p.trim().length > 20)
    .map((p) => p.trim())
  return paragraphs.map((p) => (/[.!?]$/.test(p) ? p : p + '.')).join('\n\n')
}

// ── Core AI steps ────────────────────────────────────────────────────

// Returns { text, fallback } where fallback is:
//   null      → real reelaboration succeeded
//   'error'   → AI call threw or returned empty (key dead, API disabled, timeout)
//   'content' → AI worked but output was too thin (legit: source had little to say)
async function reelaborateText(
  extractedText,
  imageMarkdown,
  isSocial,
  item,
  sourceName,
  sourceDate,
  sourceOpts = {},
) {
  // Brief mode: otros-medios interview → extract only the reportable fact.
  // CRITICAL: never fall back to formatTextAsFallback here — that would emit the
  // raw lifted interview, the exact thing we must not publish. On any failure or
  // when there's no reportable fact, return empty text so the caller SKIPS.
  if (sourceOpts.briefMode) {
    try {
      const prompt = extractFactsBrief(extractedText, {
        sourceDate,
        sourceName: sourceOpts.attributionName,
      })
      // thinkingBudget: 0 — a short structured extraction; "thinking" would
      // starve the output and truncate the brief mid-sentence.
      const result = await generateContent(prompt, {
        maxTokens: 1024,
        thinkingBudget: 0,
      })
      const raw = stripEmojis(cleanCodeBlocks((result.text || '').trim()).trim())
      if (!raw) return { text: '', fallback: 'error', brief: true }
      if (/^NO_FACT\b/i.test(raw)) return { text: '', fallback: 'no-fact', brief: true }
      const wordCount = raw.split(/\s+/).filter((w) => w.length > 0).length
      if (wordCount < 20) return { text: '', fallback: 'no-fact', brief: true }
      return { text: postProcessText(cleanFillerPhrases(raw)), fallback: null, brief: true }
    } catch (error) {
      console.error('Error extracting interview facts:', error.message)
      return { text: '', fallback: 'error', brief: true }
    }
  }

  try {
    const prompt = isSocial
      ? reelaborateSocialMedia(
          extractedText,
          item || { url: '', title: '', content_text: extractedText },
          sourceName || '',
          {
            competitor: sourceOpts.competitor,
            institutionName: sourceOpts.institutionName,
          },
        )
      : reelaborateArticle(
          imageMarkdown
            ? `${extractedText}\n\n${imageMarkdown}`
            : extractedText,
          {
            sourceDate,
            competitor: sourceOpts.competitor,
            institutionName: sourceOpts.institutionName,
          },
        )

    const result = await generateContent(prompt, { maxTokens: 8192 })
    // NEVER fall back to the raw source text — that would publish the original
    // (emojis, arenga, source handles, untransformed). If generation fails or
    // returns almost nothing, return empty so the caller SKIPS the item.
    if (!result.text) return { text: '', fallback: 'error' }

    let processedText = cleanCodeBlocks(result.text)

    // Strip emojis from EVERY article body (web and social) — never publish one.
    processedText = stripEmojis(processedText)

    if (isSocial) {
      processedText = processedText.replace(
        /\b(según publicó|compartió en|posteó en|difundió en|anunció en|publicó en)\s+(Facebook|Instagram|Twitter|YouTube|redes sociales|la plataforma|su cuenta)\b/gi,
        '',
      )
    }

    const wordCount = processedText
      .split(/\s+/)
      .filter((w) => w.length > 0).length
    // Brevity is fine for a local newsroom — keep short reelaborated notes. Only
    // when generation produced almost nothing do we treat it as a content failure
    // (and skip), rather than dumping the raw source.
    if (wordCount < 12) return { text: '', fallback: 'content' }
    if (isSocial && wordCount > 600) {
      processedText = processedText.split(/\s+/).slice(0, 500).join(' ')
    }

    processedText = cleanFillerPhrases(processedText)
    return { text: postProcessText(processedText), fallback: null }
  } catch (error) {
    console.error('Error reelaborating text:', error.message)
    return { text: '', fallback: 'error' }
  }
}

async function generateArticleMetadata(
  extractedText,
  isSocial,
  sourceName,
  item,
) {
  try {
    const prompt = isSocial
      ? generateSocialMediaMetadataPrompt(extractedText)
      : generateMetadataPrompt(extractedText)

    const result = await generateContent(prompt)
    if (!result.text) throw new Error('Empty AI response')

    let cleanedText = cleanCodeBlocks(result.text)

    // Remove markdown code blocks
    cleanedText = cleanedText
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim()

    const startIdx = cleanedText.indexOf('{')
    const endIdx = cleanedText.lastIndexOf('}')
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx)
      throw new Error('No JSON found')

    const jsonStr = cleanedText
      .substring(startIdx, endIdx + 1)
      .replace(/,\s*}/g, '}')
      .replace(/\n/g, ' ')
      .replace(/\r/g, '')
      .replace(/\t/g, ' ')

    let parsed
    try {
      parsed = JSON.parse(jsonStr)
    } catch (parseError) {
      console.error('JSON parse error:', parseError.message)
      console.error('Raw text:', cleanedText.substring(0, 300))
      throw new Error('Invalid JSON format')
    }

    if (!parsed.title || !parsed.bajada || !parsed.volanta)
      throw new Error('Missing fields')

    // Clean metadata fields
    parsed.title = enforceRioplatense(stripEmojis(stripMarkdown(parsed.title)))
    parsed.bajada = enforceRioplatense(stripEmojis(stripMarkdown(parsed.bajada)))
    parsed.volanta = enforceRioplatense(stripEmojis(stripMarkdown(parsed.volanta)))

    // Argentine sentence case — NO Title Case. The overline is always enforced
    // (Gemini tends to Title-Case short labels). The title is only forced when it
    // clearly looks Title-Cased, so correct sentence-case titles (with their few
    // proper-noun capitals) are left untouched.
    parsed.volanta = enforceSentenceCase(parsed.volanta)
    if (looksTitleCased(parsed.title)) {
      parsed.title = enforceSentenceCase(parsed.title)
    }
    const volantaWords = parsed.volanta.split(/\s+/)
    if (volantaWords.length > 4)
      parsed.volanta = volantaWords.slice(0, 4).join(' ')

    parsed.fallback = null
    return parsed
  } catch (error) {
    console.error('Error generating metadata:', error.message)
    return { ...generateFallbackMetadata(extractedText), fallback: 'error' }
  }
}

async function generateArticleTags(extractedText, metadata) {
  try {
    const prompt = generateTagsPrompt(extractedText, metadata)
    const result = await generateContent(prompt)
    if (!result.text) throw new Error('Empty AI response')

    const cleanedText = cleanCodeBlocks(result.text)
    const jsonMatch = cleanedText.match(/\[[\s\S]*?\]/)
    if (!jsonMatch) throw new Error('No JSON array found')

    const tags = JSON.parse(jsonMatch[0])
    if (!Array.isArray(tags) || tags.length === 0)
      throw new Error('Invalid tags')

    // Hard cap: 4 tags max, even if the model overshoots. Strip emojis, and use
    // sentence case (no Title Case) — proper nouns keep their capitals.
    const formatted = tags
      .slice(0, 4)
      .map((tag) => stripEmojis(String(tag)).trim())
      .filter((tag) => tag.length > 0)
      .map((tag) => enforceSentenceCase(tag))
      .join(', ')
    return { tags: formatted, fallback: null }
  } catch (error) {
    console.error('Error generating tags:', error.message)
    return { tags: generateFallbackTags(extractedText, metadata), fallback: 'error' }
  }
}

// ── Main pipeline ────────────────────────────────────────────────────

/**
 * Process a URL into a fully-formed article record.
 *
 * @param {string} url - The article URL
 * @param {Object} [options]
 * @param {string} [options.html]        - Pre-fetched HTML (skips fetch if provided)
 * @param {string} [options.extractedText] - Pre-extracted text (skips extraction if provided)
 * @param {Object} [options.item]        - RSS item with content_text, content_html, etc.
 * @param {string} [options.sourceName]  - Override auto-detected source name
 * @returns {Promise<Object|null>} Processed record fields or null if content insufficient
 */
export async function processArticleFromUrl(url, options = {}) {
  const isSocial = isSocialMediaUrl(url)
  const sourceName = options.sourceName || extractSourceName(url)

  // Classify the origin to drive naming + the no-lifted-interviews rule.
  // Otros medios (and unknown sources) are competitors: for their regular notes we
  // report the public fact as our own WITHOUT naming them; only their INTERVIEWS
  // get attributed (by name) when we extract the fact. Institutions may be named.
  const source = classifySource(url, options.feedId, options.sourceHints)
  const isOtroMedio = source.type !== 'institutional'
  const isNamedSource =
    source.id !== 'unknown' && !String(source.id).startsWith('feed:')
  const attributionName = isNamedSource ? source.name : sourceName
  // Use the registry's proper name (e.g. "Centro Blanco y Negro") instead of the
  // URL-derived guess ("Facebook"). For a named INSTITUTION this is also the name
  // generation must use verbatim in the copy.
  const resolvedSourceName = isNamedSource ? source.name : sourceName
  const institutionName =
    !isOtroMedio && isNamedSource ? source.name : null

  // ── 1. Scrape ──────────────────────────────────────────────────────
  let html = options.html || ''
  let text = options.extractedText || ''
  let images = []
  let imageMarkdown = ''

  if (isSocial && !text) {
    // Social media platforms block scrapers. Callers should handle
    // social URLs before reaching the pipeline. If we get here anyway,
    // return null so the caller can save just the URL.
    console.warn(`⚠️ Social media URL passed to pipeline — skipping: ${url}`)
    return null
  } else {
    // Regular article: scrape the URL with a hard timeout
    if (!html && !text) {
      try {
        html = await Promise.race([
          fetchContent(url),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Scrape timeout')), 20000),
          ),
        ])
      } catch (err) {
        console.error(`Scrape failed for ${url}: ${err.message}`)
        return null
      }
    }
    if (html && !text) {
      const extracted = extractText(html)
      text = extracted.text
    }
    if (html) {
      const imgResult = extractImagesAsMarkdown(html)
      images = imgResult.images
      imageMarkdown = imgResult.markdown

      // Fallback: extract all article images (not just captioned)
      if (images.length === 0) {
        images = extractArticleImages(html)
      }

      // Fallback: extract og:image / twitter:image from meta tags
      if (images.length === 0) {
        const metaImage = extractMetaImage(html)
        if (metaImage) {
          images = [metaImage]
        }
      }
    }

    if (!text || text.length < 50) return null
  }

  // ── 1b. Interview gate (otros medios only) ─────────────────────────
  // We cannot republish another medio's interview "by no means" — their Q&A is
  // owned expression. When detected, switch to BRIEF mode: extract only the
  // reportable fact into a short attributed brief; the conversation is discarded.
  // If the interview carries no reportable fact, brief mode yields nothing and the
  // item is skipped. Detection runs BEFORE generation so a full reelaboration
  // (which would launder the interview) is never spent.
  let briefMode = false
  if (isOtroMedio) {
    const ct = await detectInterview(text)
    if (ct.isInterview) {
      briefMode = true
      if (options.diagnostics && typeof options.diagnostics === 'object') {
        options.diagnostics.contentType = 'interview'
        options.diagnostics.interviewVia = ct.via
      }
      console.log(`📝 Otros-medios interview → fact-brief mode (via ${ct.via}): ${url}`)
    }
  }

  // ── 2. Extract embeds ──────────────────────────────────────────────
  let instagramContent = ''
  let facebookContent = ''
  let twitterContent = ''
  let youtubeContent = ''
  if (html) {
    instagramContent = extractInstagramEmbeds(html)
    facebookContent = extractFacebookEmbeds(html)
    twitterContent = extractTwitterEmbeds(html)
    youtubeContent = extractYoutubeEmbeds(html)
  }

  // ── 3. AI: article → metadata → tags (sequential to avoid rate limits) ──
  const item = options.item || { url, title: '', content_text: text }

  // Source publish date drives relative→absolute date conversion in the prompt.
  const sourceDate =
    options.sourceDate || item.date_published || item.pubDate || null

  const articleResult = await reelaborateText(
    text,
    imageMarkdown,
    isSocial,
    item,
    resolvedSourceName,
    sourceDate,
    { competitor: isOtroMedio, attributionName, institutionName, briefMode },
  )
  const article = articleResult.text

  // Brief mode skip: no reportable fact, or extraction failed. NEVER fall through
  // to publish the raw interview — drop the item entirely.
  if (
    briefMode &&
    (!article ||
      articleResult.fallback === 'no-fact' ||
      articleResult.fallback === 'error')
  ) {
    if (options.diagnostics && typeof options.diagnostics === 'object') {
      options.diagnostics.skipReason =
        articleResult.fallback === 'no-fact'
          ? 'interview-no-fact'
          : 'interview-brief-failed'
    }
    console.log(
      `⏭️  Interview brief skipped (${options.diagnostics?.skipReason || 'no-fact'}): ${url}`,
    )
    return null
  }
  if (briefMode && options.diagnostics && typeof options.diagnostics === 'object') {
    options.diagnostics.contentType = 'breve'
  }

  // Non-brief: if reelaboration produced no usable text (error or near-empty), do
  // NOT build a draft from raw source — skip the item so nothing un-reelaborated
  // (emojis, arenga, source handles) ever gets published.
  if (!briefMode && (!article || article.trim().length === 0)) {
    if (options.diagnostics && typeof options.diagnostics === 'object') {
      options.diagnostics.skipReason =
        articleResult.fallback === 'error' ? 'generation-failed' : 'content-empty'
      options.diagnostics.aiError = articleResult.fallback === 'error'
    }
    console.log(
      `⏭️  Skipped (${options.diagnostics?.skipReason || 'empty'}): ${url}`,
    )
    return null
  }

  // Brief mode derives title/tags from the FACT brief, not the raw interview, so
  // interview framing never leaks into the headline or tags.
  const metaSource = briefMode ? article : text
  const metadata = await generateArticleMetadata(
    metaSource,
    isSocial,
    resolvedSourceName,
    item,
  )

  // For social media, use richer context for tags (metadata + article)
  const tagText = isSocial
    ? `${metadata.title} ${metadata.bajada} ${article}`
    : briefMode
      ? article
      : text
  const tagsResult = await generateArticleTags(tagText, metadata)
  const tags = tagsResult.tags

  // Surface generation health to callers that opt in (curation passes a
  // diagnostics object). `aiError` means a Gemini call actually failed —
  // distinct from a thin-content fallback, which is legitimate. This lets the
  // curation pipeline refuse to save silently-degraded drafts.
  if (options.diagnostics && typeof options.diagnostics === 'object') {
    const steps = {
      reelaborate: articleResult.fallback,
      metadata: metadata.fallback ?? null,
      tags: tagsResult.fallback,
    }
    options.diagnostics.steps = steps
    options.diagnostics.aiError = Object.values(steps).some(
      (f) => f === 'error',
    )
    // The article body is the part that matters most for publish quality.
    options.diagnostics.contentFallback = articleResult.fallback !== null
  }

  // ── 4. Build record fields ─────────────────────────────────────────
  // Image attachments with fallback chain (matching RSS pipeline)
  let imageAttachments = []
  if (images.length > 0) {
    imageAttachments = images.map((imgUrl) => ({ url: imgUrl }))
  } else if (options.item?.image) {
    imageAttachments = [{ url: options.item.image }]
    images = [options.item.image]
  } else if (options.item?.attachments?.length > 0) {
    const attachUrl = options.item.attachments[0].url
    if (attachUrl) {
      imageAttachments = [{ url: attachUrl }]
      images = [attachUrl]
    }
  }

  // ── Image rights gate ──────────────────────────────────────────────
  // Institutional sources (imagePolicy 'all') keep their images untouched. For
  // otros medios / unknown (flyers-only), a vision check decides flyer (keep)
  // vs. their own photograph (drop, publish text-only). Checks the lead image;
  // drops all on a photo. Fails open — vision errors never silently lose images.
  let imageNote = null
  if (images.length > 0 && source.imagePolicy !== 'all') {
    const vision = await classifyImageForUse(images[0])
    const decision = imageDecision(source, vision.isFlyer)
    if (decision.allowed === false) {
      imageNote = `imagen descartada: ${decision.reason}${vision.watermark ? `; marca: ${vision.watermark}` : ''}`
      images = []
      imageAttachments = []
    } else if (vision.watermark) {
      imageNote = `imagen con marca de agua: ${vision.watermark}`
    } else if (decision.allowed === null) {
      imageNote = `imagen sin verificar: ${decision.reason}`
    }
  }
  if (options.diagnostics && typeof options.diagnostics === 'object') {
    options.diagnostics.imageNote = imageNote
  }

  // FUENTE field policy: a REGULAR note lifted from another medio is reported as
  // our own — we must NOT name the competitor, so the field is left blank. Their
  // INTERVIEWS (briefMode) keep the name (we attribute those), and INSTITUTIONS
  // keep their name (legitimate protagonist). The internal resolvedSourceName is
  // untouched — generation still uses it for competitor no-naming handling.
  const sourceField = isOtroMedio && !briefMode ? '' : resolvedSourceName

  const fields = {
    title: stripMarkdown(metadata.title || ''),
    overline: stripMarkdown(metadata.volanta || ''),
    excerpt: stripMarkdown(metadata.bajada || ''),
    article,
    image: imageAttachments,
    imgUrl: images.length > 0 ? images[0] : '',
    'article-images': images.slice(1).join(', '),
    url,
    source: sourceField,
    'ig-post': instagramContent || '',
    'fb-post': facebookContent || '',
    'tw-post': twitterContent || '',
    'yt-video': youtubeContent || '',
    status: 'draft',
    tags,
  }

  // Set social media type field to the URL
  const socialType = getSocialMediaType(url)
  if (socialType) fields[socialType] = url

  return fields
}
