import fs from 'node:fs'
import path from 'node:path'

for (const line of fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const { interviewHeuristic, detectInterview } = await import('../src/services/curation/content-type.js')

const samples = [
  {
    name: 'CLEAR INTERVIEW (Q&A transcript)',
    expect: 'interview',
    text: `El nuevo párroco habló con nuestro medio sobre su llegada.
—¿Cómo recibió la noticia de su designación?
—La verdad fue una sorpresa enorme, no la esperaba.
—¿Qué planes tiene para la parroquia?
—Quiero acercarme a los jóvenes y a las familias del barrio.
—¿Un mensaje para la comunidad?
—Que las puertas de la iglesia están siempre abiertas.`,
  },
  {
    name: 'NEWS NOTE (one brief quote)',
    expect: 'no',
    text: `El Municipio de Coronel Suárez anunció la apertura de inscripciones al Plan FinEs para terminar la secundaria. Las clases comenzarán en agosto en la Escuela 3. "Es una oportunidad para muchos vecinos", señaló la directora del área de Educación. Los interesados pueden inscribirse en la sede municipal de lunes a viernes.`,
  },
  {
    name: 'AGENDA NOTE',
    expect: 'no',
    text: `La Escuela Municipal de Patín Artístico presentará su show anual el 11 de julio. El espectáculo reunirá a más de cincuenta alumnas de distintas categorías. La actividad es a beneficio y las entradas se consiguen de forma anticipada.`,
  },
  {
    name: 'AMBIGUOUS (framing + a question, no transcript)',
    expect: 'maybe',
    text: `En diálogo con La Nueva Radio Suárez, el intendente se refirió a la obra del nuevo hospital. ¿Cuándo estará terminada? Según explicó, los trabajos avanzan y la inauguración se prevé para fin de año. El funcionario destacó la inversión provincial en la región.`,
  },
]

console.log('\n── interview heuristic calibration ──\n')
for (const s of samples) {
  const h = interviewHeuristic(s.text)
  const ok = h.verdict === s.expect ? '✓' : '✗'
  console.log(`${ok} expect=${s.expect.padEnd(9)} got=${h.verdict.padEnd(9)} ${s.name}`)
  console.log(`   signals: ${JSON.stringify(h.signals)}`)
}

// Exercise the full path (heuristic → Claude) on the ambiguous one.
console.log('\n── full detectInterview() on the ambiguous sample (live Claude) ──\n')
const amb = samples.find((s) => s.expect === 'maybe')
const res = await detectInterview(amb.text)
console.log(`  isInterview=${res.isInterview}  via=${res.via}  signals=${JSON.stringify(res.signals)}`)
console.log('\n── done ──\n')
