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
  return `Sos un redactor profesional de un medio digital argentino llamado Radio del Volga. Tu tarea es reescribir el siguiente artículo periodístico manteniendo toda la información factual.

TEXTO ORIGINAL:
"""
${extractedText.substring(0, 6000)}
"""

INSTRUCCIONES PASO A PASO:

PASO 1 — ANÁLISIS: Identificá los datos clave: quién, qué, cuándo, dónde, por qué, cómo. Identificá cifras, nombres propios, fechas y citas textuales.

PASO 2 — REDACCIÓN: Escribí un artículo de 300 a 500 palabras siguiendo esta estructura:

- Párrafo 1 (LEAD): Respondé las preguntas fundamentales (qué pasó, quién, cuándo, dónde). Máximo 3 oraciones.
- Párrafos 2-3 (DESARROLLO): Ampliá con detalles, contexto y datos específicos del texto original. Integrá cifras y nombres en oraciones completas.
- Párrafos 4-5 (CONTEXTO): Agregá antecedentes o información complementaria que esté presente en el original.
- Párrafo final (CIERRE): Información adicional relevante (próximos pasos, fechas futuras, datos de contacto). NO uses frases de cierre como "en resumen" ni "para concluir".

REGLAS DE FORMATO:
- SOLO párrafos de texto corrido (4 a 7 párrafos)
- Cada párrafo: 2 a 4 oraciones
- Separar párrafos con doble salto de línea
- PROHIBIDO: listas (-, *, •), numeraciones (1., 2.), subtítulos (#, ##), tablas, emojis
- Usar **negritas** en datos clave: cifras, fechas, nombres de personas/instituciones (5-7 veces máximo)
- Usar *cursivas* para términos técnicos o énfasis sutil (2-3 veces máximo)
- Citas textuales con > si existen en el original

REGLAS DE ESTILO:
- Oraciones claras, máximo 25 palabras por oración
- Voz activa preferentemente
- Español rioplatense formal (no usar "tú" ni "vosotros")
- Tono informativo y neutral, sin opiniones
- NO agregar información que no esté en el texto original
- NO inventar datos, cifras o declaraciones
- Integrar datos en oraciones completas. NUNCA enumerar datos sueltos.

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

  return `Sos un redactor profesional de un medio digital argentino llamado Radio del Volga. Transformá esta publicación de redes sociales en un artículo periodístico completo.

PUBLICACIÓN ORIGINAL:
"""
${postText.substring(0, 3000)}
"""

FUENTE: ${author}
FECHA: ${date}

OBJETIVO: Crear un artículo periodístico de 300 a 450 palabras a partir de esta publicación corta. Debés EXPANDIR el contenido con desarrollo periodístico, pero sin inventar hechos que no estén implícitos en el post original.

CÓMO EXPANDIR SIN INVENTAR:
- Si el post menciona un evento: desarrollá qué tipo de evento es, explicá el formato, mencioná la institución organizadora y su rol en la comunidad.
- Si el post menciona un horario o lugar: contextualizá la ubicación, mencioná cómo acceder.
- Si el post es un anuncio: explicá a quiénes afecta, qué implica, cuál es el contexto.
- NUNCA inventes cifras, números de teléfono, direcciones o datos que no aparezcan en el post original. Si no tenés un dato, no lo incluyas.

ESTRUCTURA (4-6 párrafos):
- Párrafo 1: Presentar el hecho principal de forma periodística (quién, qué, cuándo, dónde)
- Párrafos 2-3: Desarrollar detalles disponibles y contextualizar
- Párrafos 4-5: Información complementaria sobre la institución o el marco del anuncio
- Párrafo final: Datos de contacto o consulta SI están disponibles en el post original

FORMATO:
- SOLO párrafos de texto corrido
- PROHIBIDO: listas, subtítulos, enumeraciones, emojis, hashtags
- Usar **negritas** para fechas, horarios, nombres propios importantes (4-6 veces)
- Usar *cursivas* para énfasis (2-3 veces)
- NO mencionar "Facebook", "Instagram", "Twitter", "redes sociales"
- NO usar frases como "según publicó en", "compartió en su cuenta"
- NO usar frases de cierre como "en resumen", "para concluir"

TONO: Informativo, formal, neutral. Español rioplatense.

RESPUESTA: Devolver ÚNICAMENTE el artículo. Sin explicaciones, sin bloques de código.`
}

/**
 * Prompt for generating article metadata (title, bajada, volanta).
 * @param {string} extractedText - Article text content
 * @returns {string}
 */
export function generateMetadata(extractedText) {
  return `Sos un editor de un medio de noticias argentino. Generá metadata periodística para este artículo.

TEXTO:
"""
${extractedText.substring(0, 4000)}
"""

Generá exactamente 3 campos en formato JSON:

1. "title" — Título periodístico:
   - Máximo 80 caracteres
   - Sentence case: solo primera letra mayúscula (excepto nombres propios)
   - Debe capturar el hecho noticioso principal
   - Sin signos de exclamación, sin comillas, sin emojis
   - Ejemplo: "El municipio anunció nuevas medidas para el sector agrario"

2. "bajada" — Copete/resumen:
   - Entre 35 y 50 palabras
   - Amplia el título sin repetirlo
   - Incluye datos clave: quién, qué, cuándo, dónde
   - Tono neutral e informativo
   - Una o dos oraciones máximo

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
  return `Sos un editor de un medio de noticias argentino. Generá metadata periodística para esta publicación.

TEXTO:
"""
${postText.substring(0, 2000)}
"""

Generá exactamente 3 campos en formato JSON:

1. "title" — Título periodístico:
   - Máximo 80 caracteres
   - Sentence case: solo primera letra mayúscula (excepto nombres propios)
   - Convertir el post en un título formal y noticioso
   - Sin emojis, sin hashtags, sin signos de exclamación
   - NO mencionar ninguna red social

2. "bajada" — Copete/resumen:
   - Entre 35 y 50 palabras
   - Tono formal periodístico
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
