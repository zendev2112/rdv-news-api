import { generateMessage, REVIEW_MODEL } from '../claude-service.js'

/**
 * Claude selection for the admin News Picker.
 *
 * Gemini generates; Claude judges. This is the *selection* judgment: given the
 * fresh titles grouped by source table plus today's day sheet (editorial quotas
 * per table, src/config/day-sheet.js), Claude proposes which titles are worth
 * turning into notes. The admin screen pre-checks the picks and the human
 * confirms, adds or deselects — nothing reaches Airtable without the editor.
 * Every override is a selection-agreement data point (analytics events
 * `selection_proposed` / `selection_confirmed`).
 *
 * Tier asymmetry (the editor's rule):
 *  - local tables:     quota is a target, quality is the veto. Take everything
 *                      publishable up to the quota; short-but-clean counts.
 *                      When supply is dry the day runs lighter — never filler.
 *  - secondary tables: abundant supply, quota is exact — only the best N.
 *
 * Interactive path → synchronous message, not the Batches API (that is for the
 * non-latency-sensitive review cron).
 */

export const SELECT_MODEL = process.env.CLAUDE_SELECT_MODEL || REVIEW_MODEL

// Per-tier score floors, re-enforced in code. Locals sit lower on purpose:
// rejecting a decent local story costs rotation, the one thing that matters.
export const FLOOR = { local: 50, secondary: 60 }

const SYSTEM = `Sos el editor jefe de Radio del Volga, un medio digital de Coronel Suárez, Argentina. Recibís los títulos frescos de los feeds RSS agrupados por tabla de origen, cada tabla con su CUPO restante del día según la pauta editorial. Decidís cuáles títulos se convierten en notas.

PRIORIDAD ABSOLUTA: las tablas marcadas [LOCAL]. Lo local y regional es el producto del medio; todo lo demás es relleno alrededor.

REGLAS POR TIPO DE TABLA:
- [LOCAL]: el cupo es un objetivo, la calidad es el veto. Elegí TODO lo publicable hasta el cupo: una nota breve pero correcta y de interés local VA (aniversarios, actos, obras, deporte local, vida institucional). Si no hay material suficiente, elegí menos y listo — NUNCA completes el cupo con relleno. Descartá posts sin contenido informativo (solo fotos de partidos, "Información 👇", flyers sin hecho noticiable).
- [SECUNDARIA]: hay abundancia. Elegí EXACTAMENTE las mejores notas hasta el cupo restante, con estándar alto: relevancia real para una audiencia argentina del interior bonaerense. Si el material no da para el cupo, elegí menos.

REGLAS COMUNES:
- DUPLICADOS SEMÁNTICOS: si dos candidatos cuentan la misma noticia (aunque con títulos distintos o desde tablas DISTINTAS), elegí SOLO el mejor de todos. Nunca la misma noticia dos veces.
- TEMAS SENSIBLES: descartá muertes, accidentes graves, delitos, menores, personas privadas nombradas y política electoral partidaria.
- EVENTOS CON FECHA: no elijas convocatorias a eventos que ya pasaron.
- Puntaje: 0-100. Piso ${FLOOR.local} para [LOCAL], ${FLOOR.secondary} para [SECUNDARIA].

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
 * by source table, each group annotated with tier and remaining quota.
 */
function buildUserPrompt(feeds) {
  let idx = 0
  const groups = feeds.map((f) => {
    const tierTag = f.tier === 'local' ? '[LOCAL]' : '[SECUNDARIA]'
    const quotaTxt = `cupo restante hoy: ${f.remaining}` +
      (f.approvedToday ? ` (pauta ${f.quota}, ya aprobadas ${f.approvedToday})` : ` (pauta ${f.quota})`)
    const lines = f.items.map((it) => {
      const line = `[${idx}] ${it.title || it.url} (${relAge(it.pubDate) || 'sin fecha'})`
      idx += 1
      return line
    })
    return `## Tabla "${f.feedName}" ${tierTag} — ${quotaTxt}\n${lines.join('\n')}`
  })

  return `CANDIDATOS (elegí por índice):\n\n${groups.join('\n\n')}`
}

const DEDUP_SYSTEM = `Sos editor de un diario. Recibís títulos YA seleccionados para publicar hoy, cada uno con su tabla de origen y puntaje. Detectá los que cuentan la MISMA noticia (aunque la redacción difiera o vengan de tablas distintas) y decidí cuáles DESCARTAR, quedándote con UNA sola versión de cada noticia — preferí la más completa/periodística.

Respondé ÚNICAMENTE con JSON, sin explicaciones:
{"discard": [<índices a descartar>]}
Si no hay duplicados: {"discard": []}`

/**
 * Second pass: semantic dedup over the PICKED titles only. The first pass keeps
 * missing cross-table duplicates despite the prompt rule (same story arrives
 * via Local, Instituciones and Pueblos Alemanes with different wording), so a
 * small focused call over ~50 titles catches what the 1000-title pass can't.
 * Fail-open: any error returns the picks untouched.
 */
async function dedupePicks(picks, flat) {
  if (picks.size < 2) return picks
  const picked = flat.filter((c) => picks.has(c.url))
  const lines = picked.map(
    (c, i) => `[${i}] (${c.feedName} · ${picks.get(c.url).score}) ${c.title}`,
  )
  try {
    const text = await generateMessage({
      system: DEDUP_SYSTEM,
      prompt: lines.join('\n'),
      model: SELECT_MODEL,
      maxTokens: 1024,
    })
    const parsed = extractJson(text)
    if (!parsed || !Array.isArray(parsed.discard)) return picks
    for (const d of parsed.discard) {
      const c = picked[Number(d)]
      if (c) picks.delete(c.url)
    }
  } catch {
    // fail-open: better a duplicate the editor unticks than a dead picker
  }
  return picks
}

/**
 * Ask Claude to propose a selection over quota'd, non-recurring feed groups.
 * Each feed must carry {tier, quota, approvedToday, remaining} from the day
 * sheet (the caller attaches them).
 *
 * Never throws: on any failure it returns empty picks + an error string so the
 * picker degrades to the plain manual flow instead of blocking the admin.
 *
 * @param {Object} opts
 * @param {Array}  opts.feeds [{feedId, feedName, tier, quota, approvedToday, remaining, items:[{url,title,image,pubDate}]}]
 * @returns {Promise<{picks: Map<string, {score:number, reason:string}>, model: string, error?: string}>}
 */
export async function selectCandidates({ feeds = [] } = {}) {
  const flat = feeds.flatMap((f) =>
    f.items.map((it) => ({
      url: it.url,
      title: it.title,
      tier: f.tier || 'secondary',
      feedName: f.feedName,
    })),
  )
  if (!flat.length) return { picks: new Map(), model: SELECT_MODEL }

  let parsed
  try {
    const text = await generateMessage({
      system: SYSTEM,
      prompt: buildUserPrompt(feeds),
      model: SELECT_MODEL,
      maxTokens: 8192,
    })
    parsed = extractJson(text)
  } catch (err) {
    return { picks: new Map(), model: SELECT_MODEL, error: err.message }
  }

  if (!parsed || !Array.isArray(parsed.picks)) {
    return { picks: new Map(), model: SELECT_MODEL, error: 'unparseable-llm-output' }
  }

  // Re-enforce in code regardless of what the model returned: valid index,
  // per-tier score floor, no duplicate indices. Quotas stay advisory — a human
  // confirms every pick on the admin screen.
  const picks = new Map()
  for (const p of parsed.picks) {
    const i = Number(p?.index)
    const cand = Number.isInteger(i) ? flat[i] : undefined
    if (!cand || picks.has(cand.url)) continue
    const score = Number(p.score) || 0
    if (score < (FLOOR[cand.tier] ?? FLOOR.secondary)) continue
    picks.set(cand.url, {
      score,
      reason: String(p.reason || '').replace(/\s+/g, ' ').trim().slice(0, 140),
    })
  }

  await dedupePicks(picks, flat)

  return { picks, model: SELECT_MODEL }
}

export default { SELECT_MODEL, FLOOR, selectCandidates }
