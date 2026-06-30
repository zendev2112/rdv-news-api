import { generateMessage } from '../claude-service.js'

/**
 * Conservative interview detector for otros-medios content.
 *
 * Policy: we cannot republish another medio's interview "by no means" — the Q&A
 * is their owned *expression*, not a free fact. So when a fetched source piece is
 * an interview, the pipeline skips it BEFORE generation (no draft is created).
 *
 * Precision is the priority here: a false positive DROPS a real news note (lost
 * coverage), which is worse than letting one slip to the shadow critic. So we only
 * declare "interview" on strong evidence, push ambiguous cases to a cheap Claude
 * classify, and FAIL SAFE (treat as not-interview) whenever the classifier errors.
 */

// Explicit framing that a conversation was reproduced.
const PHRASES = [
  /en di[aá]logo con/i,
  /en una entrevista/i,
  /\bentrevist[aóeá]/i, // entrevista, entrevistó, entrevistado
  /consultad[oa] por/i,
  /dialog[oó] con/i,
]

// A dash immediately introducing a question ("—¿Qué…?") is the strongest single
// signal: it's a reproduced Q&A turn, near-unique to interviews.
function dashQuestionCount(text) {
  return (text.match(/[—–]\s*¿/g) || []).length
}

// Lines that start with an em/en-dash — common Spanish transcript formatting.
// Only meaningful when the extracted text preserves newlines.
function dashLineCount(text) {
  let n = 0
  for (const line of text.split('\n')) {
    if (/^\s*[—–]\s*\S/.test(line)) n++
  }
  return n
}

function questionCount(text) {
  return (text.match(/¿/g) || []).length
}

function phraseHits(text) {
  return PHRASES.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0)
}

/**
 * Heuristic verdict: 'interview' | 'maybe' | 'no'. Tuned conservative — only an
 * obvious transcript hits 'interview' outright; the gray zone defers to Claude.
 */
export function interviewHeuristic(text = '') {
  const dq = dashQuestionCount(text)
  const dashes = dashLineCount(text)
  const questions = questionCount(text)
  const phrases = phraseHits(text)
  const signals = { dashQuestions: dq, dashes, questions, phrases }

  // Strong — clearly a reproduced Q&A.
  if (dq >= 2) return { verdict: 'interview', signals }
  if (dashes >= 4) return { verdict: 'interview', signals }
  if (dashes >= 2 && phrases >= 1 && questions >= 3)
    return { verdict: 'interview', signals }

  // Ambiguous — some signal, not conclusive. Let Claude settle it.
  if (dq >= 1) return { verdict: 'maybe', signals }
  if (phrases >= 1 && questions >= 2) return { verdict: 'maybe', signals }
  if (dashes >= 2) return { verdict: 'maybe', signals }

  return { verdict: 'no', signals }
}

const CLAUDE_SYSTEM = `Clasificás textos periodísticos en español. Decidís si un texto es una ENTREVISTA (reproduce un diálogo o un formato pregunta-respuesta con una persona; su valor está en la conversación misma) o una NOTA informativa (relata hechos; puede incluir alguna cita breve, pero no reproduce una conversación completa). Respondé ÚNICAMENTE con JSON, sin texto extra: {"interview": true|false}`

async function claudeIsInterview(text) {
  const sample = text.slice(0, 3500)
  try {
    const out = await generateMessage({
      system: CLAUDE_SYSTEM,
      prompt: `TEXTO:\n"""\n${sample}\n"""`,
      maxTokens: 16,
    })
    const m = out.match(/\{[\s\S]*\}/)
    if (!m) return false
    return JSON.parse(m[0]).interview === true
  } catch {
    return false // fail safe: on error, don't drop the note
  }
}

/**
 * Decide whether `text` is an interview. Heuristic first; only the ambiguous
 * middle escalates to Claude.
 * @returns {Promise<{isInterview: boolean, via: 'heuristic'|'claude'|'none', signals: object}>}
 */
export async function detectInterview(text = '') {
  const h = interviewHeuristic(text)
  if (h.verdict === 'interview')
    return { isInterview: true, via: 'heuristic', signals: h.signals }
  if (h.verdict === 'no')
    return { isInterview: false, via: 'none', signals: h.signals }
  const claude = await claudeIsInterview(text)
  return { isInterview: claude, via: 'claude', signals: h.signals }
}

export default { interviewHeuristic, detectInterview }
