import { generateMessage, REVIEW_MODEL } from '../claude-service.js'
import { MIN_SCORE } from '../../config/homepage-blocks.js'

/**
 * Claude selection for the admin News Picker.
 *
 * Gemini generates; Claude judges. This is the *selection* judgment: given the
 * fresh titles grouped by source table (the list-mode shape) plus homepage
 * demand, Claude proposes which titles are worth turning into notes. The admin
 * screen pre-checks the picks and the human confirms, adds or deselects — every
 * override is a selection-agreement data point (see analytics events
 * `selection_proposed` / `selection_confirmed`).
 *
 * Interactive path → synchronous message, not the Batches API (that is for the
 * non-latency-sensitive review cron).
 */

export const SELECT_MODEL = process.env.CLAUDE_SELECT_MODEL || REVIEW_MODEL

const SYSTEM = `Sos el editor jefe de Radio del Volga, un medio digital de Coronel Suárez, Argentina. Recibís los títulos frescos de los feeds RSS, agrupados por tabla de origen, y decidís cuáles valen la pena convertir en notas para la home.

Criterios:
- VALOR INFORMATIVO: priorizá lo local y regional, lo institucional y lo que le sirve a la audiencia. Descartá relleno, notas promocionales y temas de bajo interés.
- DUPLICADOS SEMÁNTICOS: si dos candidatos cuentan la misma noticia (aunque con títulos distintos o desde tablas DISTINTAS), elegí SOLO el mejor de todos. Nunca la misma noticia dos veces.
- TEMAS SENSIBLES: descartá muertes, accidentes graves, delitos, menores, personas privadas nombradas y política electoral partidaria.
- DEMANDA: cada tabla alimenta un bloque de la home con una necesidad indicada. No sobrecargues un bloque que no necesita nada (como máximo 1 nota muy fuerte para rotarlo). Mejor dejar lugar vacío que poner relleno.
- CALIDAD SOBRE CANTIDAD: si un candidato no llega a ${MIN_SCORE}/100, no lo elijas.

Respondé ÚNICAMENTE con un objeto JSON, sin explicaciones ni bloques de código:
{"picks": [{"index": <n>, "score": <0-100>, "reason": "<motivo corto en español, máx 100 caracteres>"}]}
Incluí SOLO los candidatos que ELEGÍS (los demás se asumen descartados).`

// Pull the first JSON object/array out of an LLM response (tolerates fences/prose).
function extractJson(text) {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : text
  const start = body.search(/[[{]/)
  if (start === -1) return null
  const open = body[start]
  const close = open === '{' ? '}' : ']'
  const end = body.lastIndexOf(close)
  if (end <= start) return null
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch {
    return null
  }
}

function relAge(pubDate) {
  if (!pubDate) return ''
  const h = (Date.now() - new Date(pubDate).getTime()) / 36e5
  if (isNaN(h)) return ''
  if (h < 1) return 'hace <1h'
  if (h < 48) return `hace ${Math.round(h)}h`
  return `hace ${Math.round(h / 24)}d`
}

/**
 * Build the user prompt: candidates with a FLAT GLOBAL INDEX (index order must
 * match the flattened feeds/items order — the caller relies on this), grouped
 * by source table, each group annotated with its destination block's need.
 */
function buildUserPrompt(feeds, demand) {
  const needByFront = new Map(
    (demand || []).map((d) => [d.front, d]),
  )

  let idx = 0
  const groups = feeds.map((f) => {
    const d = needByFront.get(f.front)
    const needLine = d
      ? d.need > 0
        ? `necesita ${d.need} nota(s)`
        : d.stale
          ? 'lleno pero viejo (máx 1 para rotar)'
          : 'lleno y fresco (máx 1 solo si es muy fuerte)'
      : 'sin dato de demanda'
    const lines = f.items.map((it) => {
      const line = `[${idx}] ${it.title || it.url} (${relAge(it.pubDate) || 'sin fecha'})`
      idx += 1
      return line
    })
    return `## Tabla "${f.feedName}" → bloque "${f.blockLabel}" (${needLine})\n${lines.join('\n')}`
  })

  return `CANDIDATOS (elegí por índice):\n\n${groups.join('\n\n')}`
}

/**
 * Ask Claude to propose a selection over the list-mode feeds shape.
 *
 * Never throws: on any failure it returns empty picks + an error string so the
 * picker degrades to the plain manual flow instead of blocking the admin.
 *
 * @param {Object} opts
 * @param {Array}  opts.feeds   list-mode groups: [{feedId, feedName, front, blockLabel, items:[{url,title,image,pubDate}]}]
 * @param {Array}  [opts.demand] computeDemand() rows (advisory context only)
 * @returns {Promise<{picks: Map<string, {score:number, reason:string}>, model: string, error?: string}>}
 */
export async function selectCandidates({ feeds = [], demand = [] } = {}) {
  const flat = feeds.flatMap((f) => f.items.map((it) => it.url))
  if (!flat.length) return { picks: new Map(), model: SELECT_MODEL }

  let parsed
  try {
    const text = await generateMessage({
      system: SYSTEM,
      prompt: buildUserPrompt(feeds, demand),
      model: SELECT_MODEL,
      maxTokens: 4096,
    })
    parsed = extractJson(text)
  } catch (err) {
    return { picks: new Map(), model: SELECT_MODEL, error: err.message }
  }

  if (!parsed || !Array.isArray(parsed.picks)) {
    return { picks: new Map(), model: SELECT_MODEL, error: 'unparseable-llm-output' }
  }

  // Re-enforce in code regardless of what the model returned: valid index,
  // score floor, no duplicate indices. Demand caps stay advisory — a human
  // confirms every pick on the admin screen.
  const picks = new Map()
  for (const p of parsed.picks) {
    const i = Number(p?.index)
    const url = Number.isInteger(i) ? flat[i] : undefined
    if (!url || picks.has(url)) continue
    const score = Number(p.score) || 0
    if (score < MIN_SCORE) continue
    picks.set(url, {
      score,
      reason: String(p.reason || '').replace(/\s+/g, ' ').trim().slice(0, 140),
    })
  }

  return { picks, model: SELECT_MODEL }
}

export default { SELECT_MODEL, selectCandidates }
