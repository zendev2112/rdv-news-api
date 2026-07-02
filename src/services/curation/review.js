import { REVIEW_MODEL, textFromResult } from '../claude-service.js'

/**
 * Lean shadow-mode editorial gate.
 *
 * A single Claude critic reads one generated draft and returns a verdict. In
 * shadow mode this verdict is only *recorded* (written to the Airtable `aiReview`
 * field) — it publishes or blocks nothing. The point is to measure, per section,
 * how often Claude agrees with what the human actually does, before any
 * auto-publish authority is granted.
 *
 * The critic judges the draft as-shipped (coherence, rioplatense style, structure,
 * obvious red flags). It does NOT re-check against the original source — that is
 * the heavier "robust" gate (Phase 4), not this one.
 */

const VERDICTS = ['publish', 'hold', 'reject']
const CONFIDENCES = ['high', 'medium', 'low']

const SYSTEM = `Sos editor jefe de Radio del Volga, un medio digital argentino. Evaluás borradores de notas ya redactadas por una IA, listos para revisión humana. Tu trabajo es decidir si la nota está lista para publicarse tal como está.

Criterios:
- COHERENCIA: ¿se entiende? ¿el título y la bajada reflejan el cuerpo? ¿hay contradicciones o frases cortadas?
- ESTILO: español rioplatense formal, tercera persona, voseo. NADA de español neutro ("puedes", "debes", "tienes", "descubre"), nada de segunda persona ni imperativos al lector, nada de emojis ni hashtags.
- ESTRUCTURA: lead claro, párrafos cortos, subtítulos ## donde corresponde. Sin relleno ni fórmulas vacías.
- SEÑALES DE ALARMA: texto que parece sin reelaborar (volanta genérica como "Noticias", título que es la primera oración cruda), datos incoherentes, contenido vacío o promocional.
- OTROS MEDIOS: salvo que la nota sea una entrevista, NO debe nombrar ni atribuir información a otros medios locales (otras radios, diarios o sitios de noticias): son competencia y la información se reporta como propia. Si una nota informativa común nombra o cita a otro medio por su nombre, marcá "hold" (mención puntual a quitar) o "reject" (si está construida sobre la cita de otro medio). NO exijas atribución a una fuente: que una nota común NO nombre su origen es lo correcto, no un defecto.
- NOMBRE DE INSTITUCIÓN: una institución (club, escuela, dirección municipal, etc.) es la protagonista legítima de su propia nota y SÍ puede nombrarse. Que aparezca en forma larga y corta de la MISMA entidad —p. ej. "Centro Deportivo Sarmiento" en el cuerpo y "Deportivo Sarmiento" en la volanta o los tags— NO es una incoherencia: es la misma institución. NO marques "hold" por esa variación de forma larga/corta.

BREVEDAD (IMPORTANTE): somos una redacción local. Una nota BREVE, clara y correcta ES publicable. NO la marques "hold" ni "reject" por ser corta, escueta o de bajo interés, ni pidas "más desarrollo": las noticias locales de bajo perfil con poca información son válidas tal cual si están bien escritas. La extensión debe ser proporcional a la información disponible; no penalices que sea poca. Juzgá la calidad de lo que hay, no lo que falta.

Veredictos:
- "publish": lista para publicar (incluye notas breves y de bajo interés, si están limpias y bien escritas).
- "hold": publicable pero con UN problema puntual y corregible (p. ej. fecha sin resolver, una mención a otro medio que hay que quitar, una incoherencia puntual).
- "reject": no debe publicarse así (sin reelaborar, incoherente, vacía, promocional, fuera de estilo, o construida sobre la cita de otro medio).

Respondé ÚNICAMENTE con un objeto JSON, sin explicaciones ni bloques de código:
{"verdict": "publish|hold|reject", "confidence": "high|medium|low", "reason": "una sola línea, máximo 180 caracteres, en español"}`

/**
 * Build the per-draft user prompt from an Airtable record's fields.
 */
function buildUserPrompt(fields = {}) {
  const f = fields
  const body = (f.article || '').slice(0, 6000)
  return `VOLANTA: ${f.overline || '(vacía)'}
TÍTULO: ${f.title || '(vacío)'}
BAJADA: ${f.excerpt || '(vacía)'}
TAGS: ${f.tags || '(vacíos)'}
FUENTE: ${f.source || '(desconocida)'}

CUERPO:
"""
${body}
"""`
}

/**
 * Build one Message Batch request for a draft.
 * @param {string} customId  encodes table + recordId, e.g. "local::recXXX"
 * @param {object} fields    the Airtable record's fields
 * @param {string} [model]
 * @returns {{custom_id: string, params: object}}
 */
export function buildReviewRequest(customId, fields, model = REVIEW_MODEL) {
  return {
    custom_id: customId,
    params: {
      model,
      max_tokens: 256,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildUserPrompt(fields) }],
    },
  }
}

/**
 * Parse the critic's JSON answer into a normalized verdict, or null if unusable.
 * @returns {{verdict: string, confidence: string, reason: string}|null}
 */
export function parseVerdict(text) {
  if (!text) return null
  let raw = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  let parsed
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  const verdict = String(parsed.verdict || '').toLowerCase().trim()
  if (!VERDICTS.includes(verdict)) return null
  let confidence = String(parsed.confidence || '').toLowerCase().trim()
  if (!CONFIDENCES.includes(confidence)) confidence = 'medium'
  const reason = String(parsed.reason || '').replace(/\s+/g, ' ').trim().slice(0, 180)
  return { verdict, confidence, reason }
}

/**
 * Render the verdict into the single-line string written to Airtable `aiReview`.
 * Stable, parseable prefix so per-section agreement can be computed later.
 * e.g. "HOLD · conf:med · sin fecha confirmada · claude-sonnet-4-6 · 2026-06-29T12:00:00Z"
 */
export function formatReviewField(verdict, model = REVIEW_MODEL, at = new Date()) {
  if (!verdict) return ''
  const conf = { high: 'high', medium: 'med', low: 'low' }[verdict.confidence] || verdict.confidence
  const stamp = at instanceof Date ? at.toISOString() : String(at)
  return `${verdict.verdict.toUpperCase()} · conf:${conf} · ${verdict.reason} · ${model} · ${stamp}`
}

/** Convenience: result entry → formatted field string (or null to skip). */
export function reviewFieldFromResult(result, model = REVIEW_MODEL, at = new Date()) {
  const verdict = parseVerdict(textFromResult(result))
  if (!verdict) return null
  return formatReviewField(verdict, model, at)
}

export default {
  buildReviewRequest,
  parseVerdict,
  formatReviewField,
  reviewFieldFromResult,
}
