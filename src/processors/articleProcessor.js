// filepath: /home/zen/Documents/RDV-NEWS-API/src/processors/articleProcessor.js
const { fetchContent } = require('../services/fetcher')
const { extractText } = require('../services/contentExtractor')
const {
  extractInstagramEmbeds,
  extractFacebookEmbeds,
  extractTwitterEmbeds,
  extractYoutubeEmbeds,
} = require('../services/embeds')
const { generateMetadata, reelaborateText } = require('../services/ai')
const logger = require('../utils/logger')

// Store the standard prompt for reelaboration
const standardPrompt = `Reelaborar la siguiente noticia siguiendo estas pautas:

1. **Lenguaje**:
   - Utilizar un **español rioplatense formal**, adecuado para un contexto periodístico o informativo.
   - Emplear expresiones y giros propios del español rioplatense, pero mantener un tono profesional y respetuoso.

2. **Objetividad**:
   - Mantener un tono neutral y objetivo. No incluir juicios de valor, opiniones personales o lenguaje tendencioso.
   - Limitarse a presentar los hechos de manera clara y precisa.

3. **Claridad y Sencillez**:
   - Usar un lenguaje sencillo y accesible, evitando tecnicismos innecesarios.
   - Asegurarse de que la información sea fácil de entender para un público general.

4. **Estructura**:
   - **Título**: Crear un titular claro y descriptivo que resuma el tema central de la noticia.
   - **Bajada**: Escribir un párrafo introductorio que resuma los puntos clave de la noticia de manera concisa.
   - **Cuerpo**:
     - Organizar la información en párrafos cortos y bien estructurados.
     - Usar subtítulos (si es necesario) para dividir el texto en secciones temáticas.
     - Incluir datos, cifras y citas textuales relevantes, siempre que estén respaldados por fuentes confiables.
   - **Conclusión**: Resumir los puntos principales de la noticia sin añadir interpretaciones o valoraciones. Está prohibido usar titulos y expresiones explicitos como "en resumen", "conclusión", "en conclusión", "en resumen", "en síntesis" o similares. 

5. **Sintaxis y Visualidad**:
   - Usar oraciones cortas y directas para facilitar la lectura.
   - Incorporar elementos visuales como:
     - **Listas con viñetas** para enumerar puntos clave.
     - **Negritas** para resaltar información importante (por ejemplo, cifras o nombres propios).
     - **Citas textuales** entre comillas para destacar declaraciones relevantes.

6. **Fuentes**:
   - Si la noticia original incluye fuentes o referencias, asegurarse de citarlas correctamente.
   - Si no hay fuentes, evitar especulaciones o suposiciones.

7. **Formato de Salida**:info
   - Devolver la noticia reelaborada en formato Markdown

8. **Palabras Estrictamente Prohibidas**: Las siguiente palabras no deben aparecer en ninguna parte del texto: fusionar - fusionándose - reflejar - reflejándose - sumergir - sumergirse - en resumen - conclusión - en síntesis - markdown  

9. **Títulos**: No incluir un título en el artículo bajo ninguna circunstancia. El título ya está generado en otro campo del registro de Airtable, por lo que no es necesario repetirlo en el contenido. IMPORTANTE: Comenzar directamente con el cuerpo del texto.`

/**
 * Processes a single article
 * @param {Object} item - Article item from feed
 * @returns {Promise<Object|null>} - Processed article or null if failed
 */
async function processArticle(item) {
  try {
    logger.info(`Processing article: ${item.url}`)

    // Fetch and extract content
    const htmlContent = await fetchContent(item.url)
    if (!htmlContent) {
      logger.warn(`Failed to fetch content for URL: ${item.url}`)
      return null
    }

    const extractedText = extractText(htmlContent)
    if (!extractedText || extractedText.length < 50) {
      logger.warn(`Insufficient content for URL: ${item.url}`)
      return null
    }

    // Extract embeds
    const instagramContent = extractInstagramEmbeds(htmlContent)
    const facebookContent = extractFacebookEmbeds(htmlContent)
    const twitterContent = extractTwitterEmbeds(htmlContent)
    const youtubeContent = extractYoutubeEmbeds(htmlContent)

    // Log found embeds
    const embeds = {
      instagram: !!instagramContent,
      facebook: !!facebookContent,
      twitter: !!twitterContent,
      youtube: !!youtubeContent,
    }
    logger.info(`Found embeds for ${item.url}:`, embeds)

    // Reelaborate text
    const reelaboratedText = await reelaborateText(
      extractedText,
      standardPrompt
    )
    if (!reelaboratedText) {
      logger.warn(`Failed to reelaborate text for URL: ${item.url}`)
      return null
    }

    // Generate metadata
    const metadata = await generateMetadata(extractedText)
    if (!metadata) {
      logger.warn(`Failed to generate metadata for URL: ${item.url}`)
    }

    // Prepare record
    const attachments = item.attachments || []
    const attachmentUrls = attachments.map((attachment) => attachment.url)
    const imgUrl = [...attachmentUrls].filter(Boolean).join(', ')

    const recordFields = {
      title: metadata ? metadata.title : item.title,
      url: item.url,
      article: reelaboratedText,
      imgUrl: imgUrl,
      bajada: metadata ? metadata.bajada : 'No summary available.',
      volanta: metadata ? metadata.volanta : 'No overline available.',
    }

    // Add embeds if available
    if (instagramContent) recordFields['ig-post'] = instagramContent
    if (facebookContent) recordFields['fb-post'] = facebookContent
    if (twitterContent) recordFields['tw-post'] = twitterContent
    if (youtubeContent) recordFields['yt-video'] = youtubeContent

    logger.info(`Successfully processed article: ${item.url}`)

    return {
      fields: recordFields,
    }
  } catch (error) {
    logger.error(`Error processing article ${item.url}:`, error)
    return null
  }
}

/**
 * Processes a batch of articles
 * @param {Array} items - Array of article items
 * @returns {Promise<Array>} - Array of processed articles
 */
async function processBatch(items) {
  logger.info(`Processing batch of ${items.length} items`)

  const results = await Promise.all(items.map((item) => processArticle(item)))

  const validResults = results.filter((result) => result !== null)
  logger.info(
    `Successfully processed ${validResults.length} out of ${items.length} items`
  )

  return validResults
}

module.exports = {
  processArticle,
  processBatch,
}
