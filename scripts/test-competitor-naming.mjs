import fs from 'node:fs'
import path from 'node:path'

for (const line of fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const { reelaborateArticle, extractFactsBrief } = await import('../src/prompts/index.js')
const { generateContent } = await import('../src/services/ai-service.js')

const MEDIO_NAMES = [
  'Radio Ciudad Noticias',
  'La Nueva Radio Suárez',
  'Radio Coronel Suárez',
  'Suárez al Día',
]

function namesAnyMedio(text) {
  return MEDIO_NAMES.filter((n) => new RegExp(n, 'i').test(text))
}

// ── 1. Regular competitor note → must NOT name the competitor ──────────────
const ORQUESTA_NOTE = `La Orquesta Escuela de Coronel Suárez ofrecerá un concierto gratuito el sábado en el Teatro Municipal a las 21. Según informó Radio Ciudad Noticias, participarán más de cuarenta jóvenes músicos de la ciudad. La entrada es libre y gratuita. El director destacó el crecimiento del proyecto durante el último año.`

console.log('\n── 1. REGULAR competitor note (must NOT name competitor) ──')
{
  const prompt = reelaborateArticle(ORQUESTA_NOTE, {
    sourceDate: '2026-06-29',
    competitor: true,
  })
  const res = await generateContent(prompt, { maxTokens: 4096, thinkingBudget: 0 })
  const out = (res.text || '').trim()
  console.log(out)
  const named = namesAnyMedio(out)
  console.log(`\n   [check] names a medio? ${named.length ? '✗ ' + named.join(', ') : '✓ none'}`)
}

// ── 2. Interview brief → MUST name the source ──────────────────────────────
const INTERVIEW = `Entrevista con el padre Burgui, nuevo párroco de Coronel Suárez.
—¿Cómo recibió la noticia?
—Una sorpresa. Asumo el 4 de julio en la parroquia San José. Habrá misa de bienvenida a las 19.
—¿Planes?
—Acercarme a los jóvenes.`

console.log('\n── 2. INTERVIEW brief (MUST name the source) ──')
{
  const prompt = extractFactsBrief(INTERVIEW, {
    sourceDate: '2026-06-28',
    sourceName: 'La Nueva Radio Suárez',
  })
  const res = await generateContent(prompt, { maxTokens: 1024, thinkingBudget: 0 })
  const out = (res.text || '').trim()
  console.log(out)
  const hasSource = /La Nueva Radio Suárez/i.test(out)
  const hasQuotesDashes = /["“”]|—/.test(out)
  console.log(`\n   [check] names source? ${hasSource ? '✓' : '✗'} · quotes/dashes? ${hasQuotesDashes ? '✗ present' : '✓ none'}`)
}
console.log('\n── done ──\n')
