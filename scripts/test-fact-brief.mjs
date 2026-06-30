import fs from 'node:fs'
import path from 'node:path'

for (const line of fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const { extractFactsBrief } = await import('../src/prompts/index.js')
const { generateContent } = await import('../src/services/ai-service.js')

const HARD_NEWS_INTERVIEW = `Entrevista con el padre Burgui, nuevo párroco de Coronel Suárez.
—¿Cómo recibió la noticia de su designación?
—Fue una sorpresa enorme. El obispado me confirmó que asumo el 4 de julio en la parroquia San José.
—¿Qué planes tiene?
—Quiero acercarme a los jóvenes. Habrá una misa de bienvenida ese mismo día a las 19.
—¿Un mensaje para la comunidad?
—Que las puertas están abiertas.`

const COLOR_INTERVIEW = `Entrevista con un vecino histórico del barrio.
—¿Qué recuerdos tiene de su infancia acá?
—Eran otras épocas, jugábamos en la calle, todo era más tranquilo.
—¿Extraña esos tiempos?
—Y sí, uno siempre extraña. Pero la vida sigue y hay que adaptarse.
—¿Algún consejo para los jóvenes?
—Que disfruten, que el tiempo pasa rápido.`

for (const [name, text] of [
  ['HARD-NEWS INTERVIEW (expect a brief)', HARD_NEWS_INTERVIEW],
  ['PURE-COLOR INTERVIEW (expect NO_FACT)', COLOR_INTERVIEW],
]) {
  console.log(`\n── ${name} ──`)
  const prompt = extractFactsBrief(text, {
    sourceDate: '2026-06-28',
    sourceName: 'La Nueva Radio Suárez',
  })
  const res = await generateContent(prompt, { maxTokens: 1024, thinkingBudget: 0 })
  const out = (res.text || '').trim()
  console.log(out || '(empty)')
  // Quick checks
  if (!/^NO_FACT\b/i.test(out)) {
    const hasQuotes = /["“”]/.test(out) || /—/.test(out)
    const hasAttribution = /La Nueva Radio Suárez/i.test(out)
    const words = out.split(/\s+/).filter(Boolean).length
    console.log(`   [check] words=${words} · attribution=${hasAttribution} · quotes/dashes=${hasQuotes}`)
  }
}
console.log('\n── done ──\n')
