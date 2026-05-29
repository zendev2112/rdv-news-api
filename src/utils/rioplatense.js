/**
 * Rioplatense Spanish guardrail.
 *
 * The reelaboration prompts demand formal Rioplatense Spanish and explicitly
 * forbid neutral/peninsular forms ("puedes", "debes", second-person "tú", etc.).
 * Gemini still leaks those forms occasionally, so this module enforces the rule
 * deterministically AFTER generation.
 *
 * Design constraints:
 *  - Only convert forms that are UNAMBIGUOUSLY second-person/peninsular.
 *    A 3rd-person present like "puede" or "descubre" is valid Rioplatense and
 *    must NOT be touched. We therefore only map the "-as"/"-es" tú-indicative
 *    forms (whose 3rd-person counterpart drops the final s) and skip any form
 *    that collides with a common noun ("cuentas", "muestras", "tomas"...).
 *  - Preserve the original capitalization of the first letter.
 *  - Word boundaries are unicode-aware so accented forms ("tú") match cleanly.
 */

// Neutral / peninsular  →  Rioplatense (voseo)
// Curated: every key is unambiguously 2nd-person tú or a peninsular pronoun.
const REPLACEMENTS = [
  // multiword first
  ['contigo', 'con vos'],

  // ser / ir / venir / poner / decir
  ['eres', 'sos'],
  ['vienes', 'venís'],
  ['pones', 'ponés'],
  ['dices', 'decís'],

  // poder / deber / tener / querer / hacer / saber / conocer
  ['puedes', 'podés'],
  ['debes', 'debés'],
  ['tienes', 'tenés'],
  ['quieres', 'querés'],
  ['haces', 'hacés'],
  ['sabes', 'sabés'],
  ['conoces', 'conocés'],

  // -ir verbs
  ['vives', 'vivís'],
  ['pides', 'pedís'],
  ['sientes', 'sentís'],
  ['sigues', 'seguís'],
  ['eliges', 'elegís'],
  ['recibes', 'recibís'],
  ['escribes', 'escribís'],
  ['decides', 'decidís'],
  ['permites', 'permitís'],

  // stem-changing -ar / -er
  ['encuentras', 'encontrás'],
  ['recuerdas', 'recordás'],
  ['piensas', 'pensás'],
  ['empiezas', 'empezás'],
  ['entiendes', 'entendés'],
  ['pierdes', 'perdés'],
  ['juegas', 'jugás'],
  ['vuelves', 'volvés'],

  // regular -ar (3rd person drops the final s, so "-as" is unambiguous here)
  ['necesitas', 'necesitás'],
  ['trabajas', 'trabajás'],
  ['buscas', 'buscás'],
  ['llevas', 'llevás'],
  ['usas', 'usás'],
  ['miras', 'mirás'],
  ['hablas', 'hablás'],

  // pronouns (accented "tú" is the pronoun; bare "tu" is possessive — leave it)
  ['tú', 'vos'],
  ['ti', 'vos'],
]

// Unicode-aware word boundary: not preceded/followed by a letter or digit.
const BEFORE = '(?<![\\p{L}\\p{N}])'
const AFTER = '(?![\\p{L}\\p{N}])'

const COMPILED = REPLACEMENTS.map(([neutral, rio]) => ({
  re: new RegExp(`${BEFORE}(${neutral})${AFTER}`, 'giu'),
  rio,
}))

function applyCase(sample, replacement) {
  // Preserve the leading capital of the matched word.
  if (sample.charAt(0) === sample.charAt(0).toUpperCase() &&
      sample.charAt(0) !== sample.charAt(0).toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1)
  }
  return replacement
}

/**
 * Rewrite unambiguous neutral/peninsular forms into Rioplatense voseo.
 * @param {string} text
 * @returns {string}
 */
export function enforceRioplatense(text) {
  if (!text) return ''
  let out = text
  for (const { re, rio } of COMPILED) {
    out = out.replace(re, (match) => applyCase(match, rio))
  }
  return out
}

// Residual neutral-Spanish markers we can detect but NOT safely auto-fix
// (imperative CTAs collide with valid 3rd-person indicative, so we only flag
// them for monitoring instead of mutating the text).
const NEUTRAL_MARKERS = [
  /\bno te pierdas\b/gi,
  /\bent[ée]rate\b/gi,
  /\bvosotros\b/gi,
  /\bos\s+(invitamos|esperamos|recordamos)\b/gi,
  /\b(puedes|debes|tienes|quieres|eres)\b/gi, // should be gone after enforce()
]

/**
 * Return the list of residual neutral-Spanish markers still present.
 * Useful for logging so prompt/quality regressions stay visible.
 * @param {string} text
 * @returns {string[]} unique lowercased matches
 */
export function detectNeutralSpanish(text) {
  if (!text) return []
  const found = new Set()
  for (const re of NEUTRAL_MARKERS) {
    const matches = text.match(re)
    if (matches) matches.forEach((m) => found.add(m.toLowerCase()))
  }
  return [...found]
}
