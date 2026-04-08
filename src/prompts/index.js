/**
 * Centralized AI prompts for RDV News article generation.
 *
 * Each prompt is a function that receives context and returns the prompt string.
 * This makes prompts testable, iterable, and maintainable independently.
 */

/**
 * Prompt for rewriting a regular article from extracted web content.
 * @param {string} extractedText - Raw text extracted from the source URL
 * @returns {string}
 */
export function reelaborateArticle(extractedText) {
  return `Sos un redactor SEO de un medio digital argentino llamado Radio del Volga. Tu tarea es reescribir el siguiente artículo para máximo rendimiento en buscadores y legibilidad web.

TEXTO ORIGINAL:
"""
${extractedText.substring(0, 6000)}
"""

OBJETIVO: Artículo periodístico optimizado para SEO, conciso, atractivo y escaneable. NO inflés ni rellenes. Si la información original es breve, el artículo debe ser breve. Calidad > cantidad.

EXTENSIÓN ADAPTATIVA:
- Si el texto original tiene poca información: 150 a 250 palabras (NO inflar)
- Si el texto original tiene información moderada: 250 a 350 palabras
- Si el texto original es extenso y rico en datos: 350 a 500 palabras
- REGLA DE ORO: Cada oración debe aportar información nueva. CERO relleno.

ESTRUCTURA SEO:

- Párrafo 1 (LEAD SEO — máximo 2 oraciones): Respondé qué pasó, quién, cuándo y dónde. Este párrafo es el snippet de Google. Debe funcionar como resumen autónomo.
- Párrafos centrales (DESARROLLO): Un párrafo por cada dato o aspecto relevante. Oraciones cortas y directas. Integrá palabras clave naturalmente (nombres, lugares, instituciones, temas).
- EVENTOS Y FECHAS: Si el artículo menciona fechas futuras, horarios, lugares de eventos o plazos, resaltá esa información con **negritas** y ubicala en un párrafo dedicado cerca del inicio.
- Párrafo final: Solo si hay datos adicionales concretos (próximos pasos, contacto, fechas). Si no hay, NO agregues cierre genérico.

REGLAS SEO:
- Primera oración: incluir el dato noticioso principal con palabras clave del tema
- Usar **negritas** en: fechas, horarios, cifras, nombres de personas, instituciones y lugares clave (5-8 veces)
- Usar *cursivas* solo para términos técnicos o énfasis puntual (1-2 veces)
- Oraciones de máximo 20 palabras — ideales para lectura móvil
- Párrafos cortos: 2-3 oraciones máximo por párrafo
- Voz activa siempre que sea posible
- NO usar frases vacías: "cabe destacar", "es importante mencionar", "en este contexto", "por su parte", "en ese sentido", "vale la pena señalar"
- NO repetir información ya dicha en otro párrafo
- NO usar fórmulas de cierre: "en resumen", "para concluir", "de esta manera"

FORMATO:
- SOLO párrafos de texto corrido (3 a 7 párrafos según el contenido)
- Separar párrafos con doble salto de línea
- PROHIBIDO: listas (-, *, •), numeraciones (1., 2.), subtítulos (#, ##), tablas, emojis
- Citas textuales con > solo si son declaraciones relevantes del original

ESTILO:
- Español rioplatense formal
- Tono informativo, directo, sin opiniones
- NO agregar información que no esté en el texto original
- NO inventar datos, cifras ni declaraciones

RESPUESTA: Devolver ÚNICAMENTE el artículo reescrito. Sin explicaciones, sin comentarios, sin bloques de código.`
}

/**
 * Prompt for expanding a short social media post into a full article.
 * @param {string} postText - Original social media post text
 * @param {Object} item - Feed item with metadata
 * @param {string} sourceName - Name of the source/author
 * @returns {string}
 */
export function reelaborateSocialMedia(postText, item, sourceName) {
  const author = item.authors?.[0]?.name || sourceName || 'Institución local'
  const date = item.date_published || 'Reciente'

  return `Sos un redactor SEO de un medio digital argentino llamado Radio del Volga. Transformá esta publicación de redes sociales en un artículo periodístico optimizado para buscadores.

PUBLICACIÓN ORIGINAL:
"""
${postText.substring(0, 3000)}
"""

FUENTE: ${author}
FECHA: ${date}

OBJETIVO: Convertir este post en un artículo periodístico SEO-friendly. NO inflés el contenido. Si el post tiene poca información, el artículo debe ser proporcionalmente breve.

EXTENSIÓN ADAPTATIVA:
- Post corto (anuncio simple, un dato): 150 a 200 palabras
- Post con varios datos (evento, detalles, horarios): 200 a 350 palabras
- Post extenso con mucha información: 350 a 450 palabras
- REGLA: Cada oración debe aportar información nueva. CERO relleno.

ESTRUCTURA SEO:
- Párrafo 1 (LEAD SEO — máximo 2 oraciones): Qué se anunció/informó, quién, cuándo, dónde. Debe funcionar como snippet de Google.
- EVENTOS Y FECHAS: Si el post menciona fechas, horarios, lugares o plazos, resaltá esa información con **negritas** en un párrafo dedicado cerca del inicio.
- Párrafos centrales: Desarrollá los detalles disponibles. Un párrafo por aspecto. NO inventes información.
- Párrafo final: Datos de contacto o consulta SOLO si aparecen en el post original. Si no hay, no cierres.

REGLAS:
- **Negritas** en fechas, horarios, lugares, nombres propios clave (4-6 veces)
- *Cursivas* solo para énfasis puntual (1-2 veces)
- Oraciones de máximo 20 palabras
- Párrafos de 2-3 oraciones
- PROHIBIDO: listas, subtítulos, enumeraciones, emojis, hashtags
- NO mencionar "Facebook", "Instagram", "Twitter", "redes sociales"
- NO usar frases como "según publicó en", "compartió en su cuenta"
- NO usar frases vacías ni de cierre genérico
- NUNCA inventar cifras, teléfonos, direcciones o datos que no estén en el post

TONO: Informativo, directo, español rioplatense formal.

RESPUESTA: Devolver ÚNICAMENTE el artículo. Sin explicaciones, sin bloques de código.`
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

Generá exactamente 3 campos en formato JSON:

1. "title" — Título SEO:
   - Entre 50 y 70 caracteres (óptimo para Google)
   - Sentence case: solo primera letra mayúscula (excepto nombres propios)
   - DEBE contener la palabra clave principal del artículo (tema, nombre, lugar)
   - Que genere interés sin ser clickbait
   - Sin signos de exclamación, sin comillas, sin emojis
   - Si hay un evento futuro, incluir la fecha o referencia temporal en el título
   - Ejemplo: "Bahía Blanca: el municipio lanza nuevas medidas para el agro en julio"

2. "bajada" — Meta description / copete:
   - Entre 120 y 155 caracteres (óptimo para snippet de Google)
   - Complementa el título con datos clave: quién, qué, cuándo, dónde
   - Incluir palabras clave secundarias que no estén en el título
   - Tono informativo que invite a leer
   - Una o dos oraciones máximo
   - Si hay fechas/horarios de eventos, incluirlos acá

3. "volanta" — Cintillo superior:
   - Máximo 3 palabras
   - Indica el tema general o categoría
   - Sentence case
   - No repetir palabras del título
   - Ejemplos: "Economía nacional", "Salud pública", "Política local"

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

Generá exactamente 3 campos en formato JSON:

1. "title" — Título SEO:
   - Entre 50 y 70 caracteres (óptimo para Google)
   - Sentence case: solo primera letra mayúscula (excepto nombres propios)
   - DEBE contener la palabra clave principal (tema, nombre, lugar, evento)
   - Sin emojis, sin hashtags, sin signos de exclamación
   - Si hay un evento futuro, incluir la fecha o referencia temporal
   - NO mencionar ninguna red social

2. "bajada" — Meta description / copete:
   - Entre 120 y 155 caracteres (óptimo para snippet de Google)
   - Tono informativo que invite a leer
   - Incluir palabras clave que complementen el título
   - Si hay fechas/horarios, incluirlos
   - NO mencionar Facebook, Instagram, Twitter, YouTube, redes sociales
   - Sin emojis

3. "volanta" — Cintillo superior:
   - Máximo 3 palabras
   - Sentence case
   - Ejemplos: "Cultura local", "Actividades municipales", "Convocatorias"

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

  return `Analizá este artículo y generá entre 5 y 8 etiquetas (tags) relevantes.

TÍTULO: ${title}
BAJADA: ${bajada}
CONTENIDO: "${extractedText.substring(0, 3000)}"

REGLAS:
1. Identificá nombres propios (personas, lugares, organizaciones, eventos)
2. Identificá temas principales
3. Cada etiqueta: 1 a 3 palabras
4. NO usar hashtags (#)
5. Priorizar sustantivos y conceptos concretos
6. NO incluir palabras genéricas como "noticia", "actualidad", "información"
7. Incluir al menos 1 nombre propio si existe en el texto
8. Incluir al menos 1 tema/categoría temática

Responder SOLO con un array JSON. Sin explicaciones.

["etiqueta1", "etiqueta2", "etiqueta3", "etiqueta4", "etiqueta5"]`
}
