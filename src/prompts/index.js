/**
 * Centralized AI prompts for RDV News article generation.
 *
 * Each prompt is a function that receives context and returns the prompt string.
 * This makes prompts testable, iterable, and maintainable independently.
 */

/**
 * Format a source publish date as an absolute Spanish (es-AR) date, or null.
 * Used to let the model resolve relative references ("ayer", "hoy") that are
 * relative to when the SOURCE published — wrong once we republish later.
 */
export function formatSourceDate(d) {
  if (!d) return null
  try {
    const date = new Date(d)
    if (Number.isNaN(date.getTime())) return null
    return date.toLocaleDateString('es-AR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return null
  }
}

// Shared "facts only" rule — keep verifiable facts, drop opinion/cheerleading.
// Local institutions (clubs especially) post arenga and promotion; we scrape the
// fact, not the sentiment.
const FACTS_ONLY_RULE = `SOLO HECHOS (REGLA INNEGOCIABLE): redactá ÚNICAMENTE hechos verificables (qué pasó, quién, cuándo, dónde, resultados, cifras, fechas, lugares, datos concretos). PROHIBIDO incluir:
- Opiniones, valoraciones, interpretaciones o adjetivación emotiva/épica.
- Frases motivacionales, de aliento o de orgullo (ej.: "con trabajo, compromiso y orgullo de defender nuestros colores, nuestros chicos irán por la clasificación").
- Lenguaje de hinchada o promocional y primera persona del plural ("nuestros chicos", "nuestros colores", "nuestro equipo", "vamos").
- Llamados a la acción al lector ("los esperamos", "no te lo pierdas", "acompañá").
Si el texto original es mayormente arenga, opinión o promoción, quedate SOLO con el hecho concreto y descartá el resto. Si no hay ningún hecho concreto, no inventes para rellenar.

FUENTE COMO PROTAGONISTA, NO COMO EMISOR: nombrá a la institución solo como protagonista del hecho (ej.: "el equipo de Centro Deportivo Sarmiento ganó…"), NUNCA como quien comunica la nota. PROHIBIDAS las fórmulas de atribución a la fuente: "informó", "anunció", "comunicó", "difundió", "dio a conocer", "según informó", "la información difundida por…". El lector no necesita saber quién publicó la información.`

/**
 * Prompt for extracting only the reportable FACTS from another medio's interview.
 *
 * We cannot republish another medio's interview "by no means" — the Q&A is their
 * owned expression. But the underlying news fact is free. This prompt produces a
 * short, attributed brief of the fact only (no quotes, no Q&A, no reconstruction),
 * or the literal token NO_FACT when the interview carries no reportable news
 * (pure opinion/color) — in which case the caller skips it.
 *
 * @param {string} extractedText
 * @param {Object} [opts]
 * @param {string} [opts.sourceDate]  - Source publish date (relative→absolute conversion)
 * @param {string} [opts.sourceName]  - Medio to attribute to (e.g. "La Nueva Radio Suárez")
 * @returns {string}
 */
export function extractFactsBrief(extractedText, opts = {}) {
  const sourceDate = formatSourceDate(opts.sourceDate)
  const dateLine = sourceDate
    ? `\nFECHA DE PUBLICACIÓN DE LA FUENTE: ${sourceDate}. Convertí toda referencia temporal relativa ("ayer", "hoy", "mañana", "este viernes") a su fecha absoluta. No inventes fechas.`
    : ''
  const src = opts.sourceName || 'otro medio'
  return `Sos editor de Radio del Volga, un medio digital argentino. El siguiente texto es una ENTREVISTA publicada por ${src} (otro medio). NO podemos reproducir la entrevista: las preguntas, las respuestas, las citas textuales y el formato de diálogo son contenido de ${src}, no nuestro.

TU TAREA: extraer ÚNICAMENTE el HECHO noticioso concreto que surge de la entrevista (qué pasó, quién, cuándo, dónde, qué se anunció o decidió) y redactar un BREVE informativo propio, corto y atribuido.

TEXTO ORIGINAL (entrevista de ${src}):
"""
${extractedText.substring(0, 6000)}
"""${dateLine}

REGLAS INNEGOCIABLES:
- PROHIBIDO reproducir citas textuales, preguntas, respuestas o el formato de diálogo. Nada entre comillas tomado de la entrevista.
- PROHIBIDO reconstruir o parafrasear la conversación entera. Solo el hecho noticioso.
- ATRIBUCIÓN OBLIGATORIA: indicá que la información surge de ${src} (ej.: "según señaló en una entrevista con ${src}").
- EXTENSIÓN: breve, entre 40 y 110 palabras. Un solo bloque de texto. Sin subtítulos, sin listas, sin negritas.
- Español rioplatense formal, tercera persona. PROHIBIDO el español neutro ("puedes", "debes", "descubre"), dirigirse al lector, emojis o hashtags.
- Solo hechos presentes en el texto. No inventes datos ni cifras.

SI NO HAY UN HECHO NOTICIOSO CONCRETO Y REPORTABLE (la entrevista es solo opinión, color, anécdotas o charla sin novedad informativa), respondé EXACTAMENTE con la palabra: NO_FACT

RESPUESTA: devolvé ÚNICAMENTE el breve redactado, o NO_FACT. Sin explicaciones ni comentarios.`
}

/**
 * Prompt for rewriting a regular article from extracted web content.
 * @param {string} extractedText - Raw text extracted from the source URL
 * @param {Object} [opts]
 * @param {string} [opts.sourceDate] - Source publish date (for relative→absolute conversion)
 * @param {boolean} [opts.competitor] - Source is another medio (competitor) → never name it
 * @param {string} [opts.institutionName] - Institution that published it → use this exact name
 * @returns {string}
 */
export function reelaborateArticle(extractedText, opts = {}) {
  const sourceDate = formatSourceDate(opts.sourceDate)
  const institutionBlock = opts.institutionName
    ? `
INSTITUCIÓN DE ORIGEN: la información proviene de "${opts.institutionName}". Cuando te refieras a la institución, usá ESE nombre exacto, con la ortografía y mayúsculas correctas. NO uses el nombre de la red social (Facebook, Instagram) como fuente, ni abreviaturas, ni una versión en minúsculas.
`
    : ''
  const dateBlock = sourceDate
    ? `
FECHA DE PUBLICACIÓN DE LA FUENTE: ${sourceDate}
CONVERSIÓN DE FECHAS (OBLIGATORIO): la fuente se publicó en esa fecha. Convertí TODA referencia temporal relativa ("ayer", "hoy", "mañana", "anoche", "este viernes", "el próximo lunes", "esta semana", "el fin de semana") a su fecha absoluta (ej.: "el martes 24 de junio"). Si una referencia no se puede resolver con certeza a partir de esa fecha, omitila o reformulala sin inventar una fecha.
`
    : ''
  const competitorBlock = opts.competitor
    ? `
FUENTE DE OTRO MEDIO (OBLIGATORIO): la información proviene de otro medio local, que es COMPETENCIA. PROHIBIDO mencionar, nombrar, citar o atribuir nada a ese medio o a cualquier otro medio, radio, diario o sitio de noticias (ej.: NUNCA escribas "según informó [medio]", "de acuerdo con [radio]", "en diálogo con [medio]"). Redactá el hecho como información propia de Radio del Volga. Si el texto original atribuye algo a un medio o trae citas textuales de una entrevista, ELIMINÁ esa atribución y parafraseá el hecho; NO reproduzcas citas textuales entre comillas tomadas de otra fuente.
`
    : ''
  return `Sos un redactor SEO de un medio digital argentino llamado Radio del Volga. Tu tarea es reescribir el siguiente artículo para máximo rendimiento en buscadores y legibilidad web.

TEXTO ORIGINAL:
"""
${extractedText.substring(0, 6000)}
"""
${dateBlock}${competitorBlock}${institutionBlock}
${FACTS_ONLY_RULE}

OBJETIVO: Artículo periodístico optimizado para SEO, conciso, atractivo y escaneable. NO inflés ni rellenes. Si la información original es breve, el artículo debe ser breve. Calidad > cantidad.

EXTENSIÓN ADAPTATIVA:
- Si el texto original tiene poca información: 150 a 250 palabras (NO inflar)
- Si el texto original tiene información moderada: 250 a 350 palabras
- Si el texto original es extenso y rico en datos: 350 a 500 palabras
- REGLA DE ORO: Cada oración debe aportar información nueva. CERO relleno.

ESTRUCTURA SEO:

- Párrafo 1 (LEAD SEO — máximo 2 oraciones): Respondé qué pasó, quién, cuándo y dónde. Este párrafo es el snippet de Google. Debe funcionar como resumen autónomo. EMPEZÁ POR EL HECHO, no por la fuente: PROHIBIDO abrir con "[institución/medio/fuente] informó/anunció/comunicó/difundió/dio a conocer que…" o con "La fuente … informó". Tampoco uses "Radio del Volga informó". Entrá directo a la noticia.
- EVENTOS Y FECHAS: Si el artículo menciona fechas futuras, horarios, lugares de eventos o plazos, resaltá esa información con **negritas** y ubicala en un párrafo dedicado cerca del inicio.
- Párrafos centrales (DESARROLLO): Un párrafo por cada dato o aspecto relevante. Oraciones cortas y directas. Integrá palabras clave naturalmente.
- Párrafo final: Solo si hay datos adicionales concretos (próximos pasos, contacto, fechas). Si no hay, NO agregues cierre genérico.

FORMATO Y ESTRUCTURA VISUAL:
- JERARQUÍA DE TÍTULOS (clave para SEO y para que los crawlers de IA extraigan el contenido):
  - NO uses # (H1): el H1 es el título de la nota, se agrega aparte.
  - Usá ## (H2) para cada sección temática principal. Todo artículo de más de 150 palabras DEBE tener al menos un ## (H2). El primer ## va después del párrafo lead.
  - Usá ### (H3) para subdividir una sección H2 cuando tenga varios aspectos.
  - Los títulos deben ser descriptivos y contener palabras clave del tema (ej: "## Requisitos para inscribirse", no "## Detalles").
- Usá listas con viñetas (- item) cuando haya enumeraciones de datos concretos: requisitos, pasos, participantes, horarios, etc.
- Párrafos cortos: 2-3 oraciones máximo por párrafo
- Separar párrafos con doble salto de línea
- Citas textuales con > solo si son declaraciones relevantes del original
- PROHIBIDO: tablas, emojis, hashtags
- Usar **negritas** en: fechas, horarios, cifras, nombres de personas, instituciones y lugares clave (5-8 veces)
- Usar *cursivas* solo para términos técnicos o énfasis puntual (1-2 veces)

SUBTÍTULOS EN FORMA DE PREGUNTA (para SEO y extractabilidad por IA):
- Cuando sea natural, redactá algunos de los subtítulos ## (H2) como una pregunta que un lector escribiría en un buscador, y respondela en el párrafo siguiente (ej: "## ¿Cuándo se realiza el operativo?" y debajo el dato).
- Estas preguntas son subtítulos NORMALES del cuerpo de la noticia, integrados en el desarrollo. NUNCA agrupes las preguntas en una sección aparte ni uses rótulos como "Preguntas frecuentes", "FAQ" o "Glosario": esto es una noticia, no un instructivo.
- Las respuestas SOLO pueden usar datos que ya están en el texto original. Prohibido inventar.
- Si el tema no se presta a preguntas naturales, usá subtítulos afirmativos comunes. No fuerces preguntas.

REGLAS SEO:
- Primera oración: incluir el dato noticioso principal con palabras clave del tema
- Oraciones de máximo 20 palabras — ideales para lectura móvil
- Voz activa siempre que sea posible
- NO usar frases vacías: "cabe destacar", "es importante mencionar", "en este contexto", "por su parte", "en ese sentido", "vale la pena señalar"
- NO repetir información ya dicha en otro párrafo
- NO usar fórmulas de cierre: "en resumen", "para concluir", "de esta manera"

ESTILO — ESPAÑOL RIOPLATENSE FORMAL (REGLA INNEGOCIABLE):
- Escribí en español rioplatense formal (el de Argentina). ESTÁ TERMINANTEMENTE PROHIBIDO el español neutro o peninsular.
- Conjugación: usá VOSEO, nunca el "tú". Formas neutras prohibidas y su reemplazo obligatorio:
  - "puedes" → "podés" · "debes" → "debés" · "tienes" → "tenés" · "quieres" → "querés"
  - "haces" → "hacés" · "sabes" → "sabés" · "conoces" → "conocés" · "eres" → "sos"
  - "descubre/descubres" (como invitación) → eliminá la frase, reescribí en tercera persona
  - Pronombre "tú" o "ti" → "vos" · "contigo" → "con vos"
- Tono informativo, directo, en TERCERA PERSONA. El texto describe hechos, no le habla al lector.
- PROHIBIDO dirigirse al lector con imperativos o segunda persona (ni neutro ni voseo): NO usar "descubre", "descubrí", "disfrutá", "conocé", "no te pierdas", "enterate", "hacé", "animate", "mirá", "andá", "visitá", "aprovechá", "recordá", "tené en cuenta", "puedes", "podés ver".
- Antes de devolver el texto, releelo y verificá que NO quede ninguna palabra en español neutro ("puedes", "debes", "tienes", "descubre", "disfruta", "conoce"). Si encontrás alguna, reescribila.
- Sin opiniones ni valoraciones personales
- NO agregar información que no esté en el texto original
- NO inventar datos, cifras ni declaraciones

RESPUESTA: Devolver ÚNICAMENTE el artículo reescrito. Sin explicaciones, sin comentarios, sin bloques de código.`
}

/**
 * Prompt for expanding a short social media post into a full article.
 * @param {string} postText - Original social media post text
 * @param {Object} item - Feed item with metadata
 * @param {string} sourceName - Name of the source/author
 * @param {Object} [opts]
 * @param {boolean} [opts.competitor] - Source is another medio (competitor) → never name it
 * @param {string} [opts.institutionName] - Institution that published it → use this exact name
 * @returns {string}
 */
export function reelaborateSocialMedia(postText, item, sourceName, opts = {}) {
  // Prefer the registry's institution name over the FB/IG author handle.
  const author =
    opts.institutionName || item.authors?.[0]?.name || sourceName || 'Institución local'
  const absoluteDate = formatSourceDate(item.date_published)
  const date = absoluteDate || item.date_published || 'Reciente'
  const dateRule = absoluteDate
    ? `\nCONVERSIÓN DE FECHAS (OBLIGATORIO): la publicación es de la FECHA indicada. Convertí toda referencia relativa ("ayer", "hoy", "mañana", "este viernes", "esta semana") a su fecha absoluta. No inventes fechas que no se puedan deducir.`
    : ''
  const fuenteLine = opts.competitor
    ? 'FUENTE: otro medio local (COMPETENCIA — NO nombrar ni atribuir en el texto)'
    : `FUENTE: ${author}`
  const competitorRule = opts.competitor
    ? `\nFUENTE DE OTRO MEDIO (OBLIGATORIO): la publicación proviene de otro medio local, que es COMPETENCIA. PROHIBIDO mencionar, nombrar, citar o atribuir nada a ese medio o a cualquier otro medio, radio, diario o sitio de noticias. Redactá el hecho como información propia de Radio del Volga, sin atribuirlo a nadie.`
    : ''
  const institutionRule =
    !opts.competitor && opts.institutionName
      ? `\nINSTITUCIÓN DE ORIGEN: la publicación es de "${opts.institutionName}". Cuando menciones a la institución usá ESE nombre exacto, con ortografía y mayúsculas correctas. NUNCA uses el nombre de la red social (Facebook, Instagram) como fuente ni una versión en minúsculas.`
      : ''

  return `Sos un redactor SEO de un medio digital argentino llamado Radio del Volga. Reescribí esta publicación como artículo periodístico. Tu única fuente es el texto a continuación — no agregues ni inventes nada.

PUBLICACIÓN ORIGINAL:
"""
${postText.substring(0, 3000)}
"""

${fuenteLine}
FECHA: ${date}${dateRule}${competitorRule}${institutionRule}

REGLA FUNDAMENTAL: El artículo solo puede contener información que esté explícitamente en la publicación original. Si la publicación tiene 3 datos, el artículo tiene 3 datos. Prohibido agregar contexto, antecedentes, proyecciones ni información externa.

${FACTS_ONLY_RULE}

EXTENSIÓN:
- Contá los datos concretos que tiene la publicación (fecha, lugar, quién, qué, requisitos, contacto, etc.)
- Escribí exactamente esos datos, sin repetirlos ni expandirlos
- Máximo 200 palabras salvo que la publicación original tenga mucho contenido
- Mínimo: lo que haya. Si hay poco, el artículo es corto. No hay mínimo obligatorio.

ESTRUCTURA:
- Párrafo 1: EL HECHO directo — qué pasó, cuándo y dónde (máximo 2 oraciones, snippet de Google). EMPEZÁ POR LA NOTICIA, nunca por la fuente: PROHIBIDO abrir con "[institución/medio/fuente] informó/anunció/comunicó/dio a conocer que…", con "La fuente … informó" ni con "Radio del Volga informó". Entrá directo al hecho.
- Si hay fechas, horarios o lugares: resaltarlos con **negritas** en un párrafo propio
- Si hay requisitos, pasos o ítems: usar lista con viñetas (- item)
- Si hay datos de contacto o inscripción en el original: incluirlos al final
- Si no hay más datos: terminar. No agregar párrafo de cierre genérico.

FORMATO:
- Subtítulos: usá ## (H2) para secciones temáticas si el artículo supera 200 palabras. Nunca uses # (H1).
- **Negritas** en fechas, horarios, nombres propios y lugares clave
- PROHIBIDO: tablas, emojis, hashtags
- Cuando sea natural, algún subtítulo ## puede ir en forma de pregunta (ej: "## ¿Dónde se realiza?") respondida en el párrafo siguiente, integrado en el cuerpo. PROHIBIDO agrupar preguntas bajo un rótulo "Preguntas frecuentes" o "FAQ": es una noticia, no un instructivo.

ESTILO — ESPAÑOL RIOPLATENSE FORMAL (REGLA INNEGOCIABLE):
- Escribí en español rioplatense formal (Argentina), tercera persona, voz activa. PROHIBIDO el español neutro o peninsular.
- Usá VOSEO, nunca "tú". Reemplazos obligatorios: "puedes" → "podés", "debes" → "debés", "tienes" → "tenés", "quieres" → "querés", "eres" → "sos", "tú/ti" → "vos".
- Antes de devolver el texto verificá que NO quede ninguna palabra neutra ("puedes", "debes", "tienes", "descubre", "disfruta", "conoce").
- NO mencionar Facebook, Instagram, Twitter, redes sociales, ni frases como "según publicó"
- NO usar frases vacías: "cabe destacar", "en este contexto", "es importante mencionar", "en resumen"
- PROHIBIDO segunda persona o imperativos (neutro o voseo): "descubre", "descubrí", "disfrutá", "conocé", "no te pierdas", "enterate", "mirá", "aprovechá", "puedes"

RESPUESTA: Solo el artículo. Sin explicaciones, sin bloques de código.`
}

/**
 * Prompt for generating article metadata (title, bajada, volanta).
 * @param {string} extractedText - Article text content
 * @returns {string}
 */
export function generateMetadata(extractedText) {
  return `Sos un editor SEO de un medio de noticias argentino. Generá metadata optimizada para buscadores.

TEXTO:
"""
${extractedText.substring(0, 4000)}
"""

IDIOMA: español rioplatense formal (Argentina), tercera persona. PROHIBIDO español neutro/peninsular e imperativos al lector ("descubrí", "conocé", "no te pierdas", "puedes", "disfruta").

Generá exactamente 3 campos en formato JSON:

1. "title" — Título SEO:
   - Entre 50 y 70 caracteres (óptimo para Google)
   - Sentence case: solo primera letra mayúscula (excepto nombres propios)
   - DEBE contener la palabra clave principal del artículo (tema, nombre, lugar)
   - Que genere interés sin ser clickbait
   - Sin signos de exclamación, sin comillas, sin emojis
   - Si hay un evento futuro, incluir la fecha o referencia temporal en el título
   - SIN MARKDOWN: no uses **, *, _, __ ni ningún formato
   - Ejemplo: "Bahía Blanca: el municipio lanza nuevas medidas para el agro en julio"

2. "bajada" — Meta description / copete:
   - Entre 120 y 155 caracteres (óptimo para snippet de Google)
   - Complementa el título con datos clave: quién, qué, cuándo, dónde
   - Incluir palabras clave secundarias que no estén en el título
   - Tono informativo que invite a leer
   - Una o dos oraciones máximo
   - Si hay fechas/horarios de eventos, incluirlos acá
   - SIN MARKDOWN: no uses **, *, _, __ ni ningún formato

3. "volanta" — Cintillo superior:
   - Máximo 3 palabras
   - Indica el tema general o categoría
   - Sentence case, PERO con los nombres propios en mayúscula (lugares, personas, instituciones). PROHIBIDO escribir todo en mayúsculas y PROHIBIDO dejar un nombre propio en minúscula (ej. correcto: "Ambiente Suárez", "Cultura local"; MAL: "ambiente suárez", "AMBIENTE SUÁREZ")
   - No repetir palabras del título
   - SIN MARKDOWN
   - Ejemplos: "Economía nacional", "Salud pública", "Pueblos Alemanes"

RESPUESTA: Devolver SOLO el JSON, sin explicaciones ni bloques de código.

{"title": "...", "bajada": "...", "volanta": "..."}`
}

/**
 * Prompt for generating social media article metadata (no source mentions).
 * @param {string} postText - Original social media post text
 * @returns {string}
 */
export function generateSocialMediaMetadata(postText) {
  return `Sos un editor SEO de un medio de noticias argentino. Generá metadata optimizada para buscadores.

TEXTO:
"""
${postText.substring(0, 2000)}
"""

IDIOMA: español rioplatense formal (Argentina), tercera persona. PROHIBIDO español neutro/peninsular e imperativos al lector ("descubrí", "conocé", "no te pierdas", "puedes", "disfruta").

Generá exactamente 3 campos en formato JSON:

1. "title" — Título SEO:
   - Entre 50 y 70 caracteres (óptimo para Google)
   - Sentence case: solo primera letra mayúscula (excepto nombres propios)
   - DEBE contener la palabra clave principal (tema, nombre, lugar, evento)
   - Sin emojis, sin hashtags, sin signos de exclamación
   - Si hay un evento futuro, incluir la fecha o referencia temporal
   - NO mencionar ninguna red social
   - SIN MARKDOWN: no uses **, *, _, __ ni ningún formato

2. "bajada" — Meta description / copete:
   - Entre 120 y 155 caracteres (óptimo para snippet de Google)
   - Tono informativo que invite a leer
   - Incluir palabras clave que complementen el título
   - Si hay fechas/horarios, incluirlos
   - NO mencionar Facebook, Instagram, Twitter, YouTube, redes sociales
   - Sin emojis
   - SIN MARKDOWN: no uses **, *, _, __ ni ningún formato

3. "volanta" — Cintillo superior:
   - Máximo 3 palabras
   - Sentence case, PERO con los nombres propios en mayúscula (lugares, personas, instituciones). PROHIBIDO todo en mayúsculas y PROHIBIDO dejar un nombre propio en minúscula (ej. correcto: "Ambiente Suárez", "Cultura local"; MAL: "ambiente suárez")
   - SIN MARKDOWN
   - Ejemplos: "Cultura local", "Actividades municipales", "Pueblos Alemanes"

PROHIBIDO mencionar: Facebook, Instagram, Twitter, YouTube, redes sociales, "según publicó", "compartió en"

RESPUESTA: Devolver SOLO el JSON.

{"title": "...", "bajada": "...", "volanta": "..."}`
}

/**
 * Prompt for generating article tags.
 * @param {string} extractedText - Article text
 * @param {Object} metadata - Article metadata (title, bajada)
 * @returns {string}
 */
export function generateTags(extractedText, metadata) {
  const title = metadata?.title || ''
  const bajada = metadata?.bajada || ''

  return `Analizá este artículo y generá entre 3 y 4 etiquetas (tags) ESPECÍFICAS y útiles para clasificar y buscar la nota.

TÍTULO: ${title}
BAJADA: ${bajada}
CONTENIDO: "${extractedText.substring(0, 3000)}"

QUÉ ES UNA BUENA ETIQUETA:
- Un nombre propio concreto del texto: persona, lugar, institución o evento (ej.: "Coronel Suárez", "Orquesta Escuela", "Plan FinEs", "Boca Juniors").
- El tema o categoría real de la nota (ej.: "Educación", "Obras públicas", "Vóley", "Salud").
- Algo que sirva para AGRUPAR esta nota con otras del mismo protagonista o tema. Si una etiqueta no sirve para agrupar, no va.

REGLAS:
1. MÁXIMO 4 etiquetas. Mejor 3 buenas que 4 con relleno. Si solo hay 2 que valen, devolvé 2.
2. Cada etiqueta: 1 a 3 palabras. Capitalizá bien los nombres propios.
3. PROHIBIDAS las etiquetas genéricas o inútiles: "noticia", "noticias", "actualidad", "información", "novedades", "interés general", "comunidad", "local", "hoy", "Argentina" (salvo que el país sea el tema central).
4. Nada de hashtags (#), nada de verbos, nada de frases ni oraciones.
5. Priorizá nombres propios y conceptos concretos por sobre términos vagos.

Responder SOLO con un array JSON, sin explicaciones.

["Etiqueta1", "Etiqueta2", "Etiqueta3"]`
}
