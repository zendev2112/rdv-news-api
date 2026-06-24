import { generateContent } from '../ai-service.js'
import { MIN_SCORE, getBlock } from '../../config/homepage-blocks.js'

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

function buildPrompt(blocks, candidates) {
  const blockLines = blocks
    .map(
      (b) =>
        `- ${b.front} ("${b.label}") — necesita ${b.need} nota(s); feeds elegibles: [${b.eligibleFeeds.join(', ')}]`,
    )
    .join('\n')

  const candLines = candidates
    .map(
      (c, i) =>
        `[${i}] feed=${c.feedId} | ${c.title}\n    ${(c.summary || '').slice(0, 300)}`,
    )
    .join('\n')

  return `Sos un editor de un diario argentino. Tenés que decidir qué notas de una lista de candidatos publicar y en qué bloque de la home van, para LLENAR los bloques que tienen lugar libre.

BLOQUES CON LUGAR (asigná solo a estos):
${blockLines}

REGLAS:
- Un candidato del feed F solo puede ir a un bloque cuyos "feeds elegibles" incluyan F.
- Asigná cada nota a UN solo bloque (el que mejor encaje editorialmente).
- No superes la cantidad que cada bloque "necesita".
- Descartá: notas poco relevantes o de bajo interés, duplicados semánticos (misma noticia que otra de la lista, quedate con la mejor), y temas sensibles (muertes, accidentes, delitos, menores, personas privadas nombradas, política electoral). Esos van con reason.
- Calidad sobre cantidad: si una nota no llega a ${MIN_SCORE}/100, descartala. Mejor dejar el lugar vacío que poner relleno.

Devolvé SOLO JSON. Incluí ÚNICAMENTE las notas que ELEGÍS publicar en "assignments" (no enumeres las descartadas; esas se asumen no seleccionadas). En "skipped" poné solo las notas con temas sensibles. En "front" usá EXACTAMENTE el identificador del bloque (la palabra antes del paréntesis, ej: "MundoSection"), NO la etiqueta entre comillas:
{
  "assignments": [{ "index": <n>, "front": "<identificador exacto, ej MundoSection>", "score": <0-100>, "reason": "<motivo corto>" }],
  "skipped": [{ "index": <n>, "reason": "sensitive" }]
}

CANDIDATOS:
${candLines}`
}

/**
 * Score + assign candidates to hungry blocks using Gemini only.
 * Constraints (eligibility, score floor, per-block need caps) are re-enforced in
 * code so the model can't violate them.
 *
 * @returns {Promise<{assignments: Array, skipped: Array}>}
 */
export async function scoreAndAssign({
  candidates = [],
  demand = [],
  maxPerRun = Infinity,
} = {}) {
  const hungry = demand.filter((b) => b.need > 0)
  if (!candidates.length || !hungry.length) {
    return {
      assignments: [],
      skipped: candidates.map((c) => ({
        url: c.url,
        feedId: c.feedId,
        reason: 'no-hungry-block',
      })),
    }
  }

  let parsed
  try {
    const { text } = await generateContent(buildPrompt(hungry, candidates), {
      temperature: 0.2,
      maxTokens: 8192,
      thinkingBudget: 0, // structured JSON task — no thinking, keep full budget for output
    })
    if (process.env.DEBUG_SCORE) console.error('--- RAW(' + text.length + ') ---\n' + text.slice(0, 1500) + '\n--- END ---')
    parsed = extractJson(text)
  } catch (err) {
    return {
      assignments: [],
      skipped: candidates.map((c) => ({
        url: c.url,
        feedId: c.feedId,
        reason: `score-error: ${err.message}`,
      })),
    }
  }

  if (!parsed || !Array.isArray(parsed.assignments)) {
    return {
      assignments: [],
      skipped: candidates.map((c) => ({
        url: c.url,
        feedId: c.feedId,
        reason: 'unparseable-llm-output',
      })),
    }
  }

  const needLeft = new Map(hungry.map((b) => [b.front, b.need]))
  // Resolve the model's "front" by identifier OR label (it sometimes returns the
  // human label). Restricted to the hungry set.
  const resolve = (val) => {
    if (!val) return null
    const v = String(val).trim().toLowerCase()
    const b = hungry.find(
      (h) => h.front.toLowerCase() === v || h.label.toLowerCase() === v,
    )
    return b ? b.front : null
  }
  const assigned = new Set()
  const assignments = []
  const skipped = []

  // Highest score first so the best items win scarce slots.
  const ranked = [...parsed.assignments].sort(
    (a, b) => (b.score || 0) - (a.score || 0),
  )

  for (const a of ranked) {
    const c = candidates[a.index]
    if (!c || assigned.has(a.index)) continue
    const front = resolve(a.front)
    const block = getBlock(front)
    const score = Number(a.score) || 0

    // Re-enforce every constraint regardless of what the model returned.
    if (!block || !needLeft.has(front)) {
      skipped.push({ url: c.url, feedId: c.feedId, reason: 'invalid-block' })
      continue
    }
    if (!block.eligibleFeeds.includes(c.feedId)) {
      skipped.push({ url: c.url, feedId: c.feedId, reason: 'not-eligible-for-block' })
      continue
    }
    if (score < MIN_SCORE) {
      skipped.push({ url: c.url, feedId: c.feedId, reason: `below-floor(${score})` })
      continue
    }
    if (needLeft.get(front) <= 0) {
      skipped.push({ url: c.url, feedId: c.feedId, reason: 'block-full' })
      continue
    }
    if (assignments.length >= maxPerRun) {
      skipped.push({ url: c.url, feedId: c.feedId, reason: 'max-per-run' })
      continue
    }

    needLeft.set(front, needLeft.get(front) - 1)
    assigned.add(a.index)
    assignments.push({
      url: c.url,
      front,
      role: 'principal', // newest leads the block (per spec principle 4)
      feedId: c.feedId,
      score,
      reason: a.reason || '',
      title: c.title,
      image: c.image,
      pubDate: c.pubDate,
    })
  }

  // Anything the LLM explicitly skipped, plus any candidate it never mentioned.
  for (const s of parsed.skipped || []) {
    const c = candidates[s.index]
    if (c && !assigned.has(s.index)) {
      skipped.push({ url: c.url, feedId: c.feedId, reason: s.reason || 'skipped' })
    }
  }
  candidates.forEach((c, i) => {
    if (!assigned.has(i) && !skipped.some((s) => s.url === c.url)) {
      skipped.push({ url: c.url, feedId: c.feedId, reason: 'not-selected' })
    }
  })

  return { assignments, skipped }
}
