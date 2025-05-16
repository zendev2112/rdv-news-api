import axios from 'axios'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { GoogleGenerativeAI } from '@google/generative-ai'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import * as configModule from './src/config/index.js'
import * as cheerio from 'cheerio'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

// Setup dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Setup yargs for ES modules
const args = yargs(hideBin(process.argv))
  .option('all', {
    alias: 'a',
    description: 'Process all sections',
    type: 'boolean',
  })
  .option('limit', {
    alias: 'l',
    description: 'Limit the number of articles to fetch per section',
    type: 'number',
  })
  .option('force', {
    alias: 'f',
    description: 'Force reprocessing of already processed articles',
    type: 'boolean',
  })
  .help()
  .parse()

// Extract config from module
const config = configModule.default

// Log the full config object to debug
console.log('Config structure:', Object.keys(config || {}))

// Define helper functions that use config without modifying it
function getSections() {
  if (config && typeof config.getSections === 'function') {
    return config.getSections()
  }
  return config?.sections || []
}

function getSection(sectionId) {
  if (config && typeof config.getSection === 'function') {
    return config.getSection(sectionId)
  }
  return (
    (config?.sections || []).find((section) => section.id === sectionId) || null
  )
}

function getDefaultSection() {
  if (config && typeof config.getDefaultSection === 'function') {
    return config.getDefaultSection()
  }
  return (config?.sections || [])[0] || null
}

// Log config for debugging
console.log(
  'Config sections available:',
  config.sections ? config.sections.length : 0
)
console.log('Config imported properly:', !!config)
console.log('Config sections:', config.sections)
console.log('Config gemini:', config.gemini)
console.log('Config getSection function:', typeof config.getSection)

// Store the limit for use throughout the script
const ITEM_LIMIT = args.limit || Infinity // Default to no limit if not specified

console.log(
  `Fetch limit: ${
    ITEM_LIMIT === Infinity ? 'No limit' : ITEM_LIMIT
  } items per section`
)

// Determine which section(s) to process
let sectionsToProcess = []

if (args.all) {
  // Process all sections
  sectionsToProcess = getSections()
  console.log('Processing all sections')
} else if (args._[0]) {
  // Process specific section
  const requestedSectionId = args._[0]
  const section = getSection(requestedSectionId)
  if (section) {
    sectionsToProcess = [section]
    console.log(`Processing section: ${section.name}`)
  } else {
    console.error(`Section "${requestedSectionId}" not found`)
    process.exit(1)
  }
} else {
  // Default to the test section if available, otherwise first section
  const defaultSection = getDefaultSection()
  if (defaultSection) {
    sectionsToProcess = [defaultSection]
    console.log(`Processing default section: ${defaultSection.name}`)
  } else {
    const allSections = getSections()
    if (allSections && allSections.length > 0) {
      sectionsToProcess = [allSections[0]]
      console.log(`Processing first available section: ${allSections[0].name}`)
    } else {
      console.error('No sections found in configuration')
      process.exit(1)
    }
  }
}

console.log(
  `Starting fetch-to-airtable process for ${
    sectionsToProcess.length
  } section(s): ${sectionsToProcess.map((s) => s.name).join(', ')}`
)

// Import services with proper error handling
let airtableService, embeds

try {
  // ES module import
  const servicesModule = await import('./src/services/index.js')
  airtableService = servicesModule.airtableService
  embeds = servicesModule.embeds
  console.log('Successfully loaded services')
} catch (error) {
  console.error('Error loading services:', error.message)
  console.error(
    'Make sure you have created all the necessary files in src/services'
  )
  process.exit(1)
}

// Configuration from config file
const GEMINI_API_KEY =
  config?.gemini?.apiKey || process.env.GEMINI_API_KEY || ''
console.log(
  'Using GEMINI_API_KEY:',
  GEMINI_API_KEY ? 'API key found' : 'No API key'
)
const GEMINI_MODEL =
  config?.gemini?.model || process.env.GEMINI_MODEL || 'gemini-2.0-flash'
const BATCH_SIZE = 2 // Reduced from 3 to 2
const FEED_SIZE = 50 // Original feed size
const API_DELAY = 3000 // 3 seconds delay between API calls
const BATCH_DELAY = 15000 // 15 seconds delay between batches
const SECTION_DELAY = 30000 // 30 seconds delay between sections

// State directory to manage processing between runs
const STATE_DIR = path.join(__dirname, '.state')
if (!fs.existsSync(STATE_DIR)) {
  fs.mkdirSync(STATE_DIR)
}

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
const model = genAI.getGenerativeModel({ model: GEMINI_MODEL })

/**
 * Load the persisted state for a section
 */
function loadSectionState(sectionId) {
  try {
    const stateFile = path.join(STATE_DIR, `${sectionId}.json`)
    if (fs.existsSync(stateFile)) {
      const data = fs.readFileSync(stateFile, 'utf8')
      return JSON.parse(data)
    }
  } catch (error) {
    console.error(`Error loading state file for ${sectionId}:`, error.message)
  }
  return { processedUrls: [], lastRun: null }
}

/**
 * Save the current state for a section
 */
function saveSectionState(sectionId, state) {
  try {
    const stateFile = path.join(STATE_DIR, `${sectionId}.json`)
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8')
  } catch (error) {
    console.error(`Error saving state file for ${sectionId}:`, error.message)
  }
}

/**
 * Creates a delay of specified milliseconds
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Extracts images from HTML and creates markdown references
 * @param {string} htmlContent - HTML content
 * @returns {Object} - Object with markdown text and extracted images
 */
function extractImagesAsMarkdown(htmlContent) {
  try {
    const $ = cheerio.load(htmlContent)

    // Array to store image information
    const extractedImages = []
    let imageMarkdown = ''

    // Extract figures with captions
    $('figure').each((i, figure) => {
      const $figure = $(figure)
      const $img = $figure.find('img')
      const $caption = $figure.find('figcaption')

      // Only process if there's both an image and a caption
      if (
        $img.length &&
        $img.attr('src') &&
        $caption.length &&
        $caption.text().trim()
      ) {
        const imageUrl = $img.attr('src')

        // Skip SVG, tiny or data URLs
        if (imageUrl.includes('.svg') || imageUrl.startsWith('data:')) {
          return
        }

        // Skip common ad/tracking/icon domains and paths
        if (
          imageUrl.includes('ad.') ||
          imageUrl.includes('ads.') ||
          imageUrl.includes('pixel.') ||
          imageUrl.includes('analytics') ||
          imageUrl.includes('/icons/') ||
          imageUrl.includes('/social/')
        ) {
          return
        }

        const altText = $img.attr('alt') || ''
        const caption = $caption.text().trim()

        // Only include substantial images
        const width = parseInt($img.attr('width') || '0', 10)
        const height = parseInt($img.attr('height') || '0', 10)

        // Skip tiny images that are likely icons
        if ((width > 0 && width < 100) || (height > 0 && height < 100)) {
          return
        }

        extractedImages.push({
          url: imageUrl,
          altText: altText || 'Image',
          caption,
        })

        // Create markdown for this image - UPDATED FORMAT
        imageMarkdown += `**Imagen:** ${caption}\n\n`
      }
    })

    // Extract standalone images that have nearby captions
    $('img').each((i, img) => {
      const $img = $(img)

      // Skip images that are in figures (already processed)
      if ($img.closest('figure').length === 0) {
        const imageUrl = $img.attr('src')

        // Skip if no src or if it's a tiny image (likely an icon)
        if (!imageUrl || imageUrl.startsWith('data:')) return

        // Skip SVGs (likely icons or logos)
        if (imageUrl.includes('.svg')) return

        // Skip common ad/tracking/icon domains and paths
        if (
          imageUrl.includes('ad.') ||
          imageUrl.includes('ads.') ||
          imageUrl.includes('pixel.') ||
          imageUrl.includes('analytics') ||
          imageUrl.includes('/icons/') ||
          imageUrl.includes('/social/')
        ) {
          return
        }

        const altText = $img.attr('alt') || ''
        const width = parseInt($img.attr('width') || '0', 10)
        const height = parseInt($img.attr('height') || '0', 10)

        // Skip small images (likely icons)
        if ((width > 0 && width < 100) || (height > 0 && height < 100)) return

        // Try to find a nearby caption
        let caption = ''
        const $parent = $img.parent()
        const $nextSibling = $img.next()

        if (
          $nextSibling.is('em') ||
          $nextSibling.is('small') ||
          $nextSibling.is('span.caption')
        ) {
          caption = $nextSibling.text().trim()
        } else if (
          $parent.next().is('em') ||
          $parent.next().is('small') ||
          $parent.next().is('span.caption')
        ) {
          caption = $parent.next().text().trim()
        }

        // Only include images that have a caption
        if (caption && caption.length > 0) {
          // Make sure we don't have duplicate images
          if (!extractedImages.some((img) => img.url === imageUrl)) {
            extractedImages.push({
              url: imageUrl,
              altText: altText || 'Image',
              caption,
            })

            // Create markdown for this image - UPDATED FORMAT
            imageMarkdown += `**Imagen:** ${caption}\n\n`
          }
        }
      }
    })

    console.log(
      `Extracted ${extractedImages.length} captioned images from HTML content`
    )

    // Return both the raw URLs and the markdown representation
    return {
      images: extractedImages.map((img) => img.url),
      markdown: imageMarkdown,
    }
  } catch (error) {
    console.error('Error extracting images:', error.message)
    return { images: [], markdown: '' }
  }
}

/**
 * Fetches HTML content from a URL
 */
async function fetchContent(url, timeout = 10000) {
  try {
    const response = await axios.get(url, {
      timeout,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    })
    return response.data
  } catch (error) {
    console.error(`Error fetching content from ${url}:`, error.message)
    return null
  }
}

/**
 * Extracts main text content from HTML using Readability
 */
function extractText(htmlContent) {
  try {
    const dom = new JSDOM(htmlContent)
    const reader = new Readability(dom.window.document)
    const article = reader.parse()
    return article && article.textContent ? article.textContent.trim() : ''
  } catch (error) {
    console.error(`Error extracting text:`, error.message)
    return ''
  }
}

/**
 * Post-process text to fix formatting issues
 */
function postProcessText(text) {
  // Fix lists that might have wrong spacing
  let fixed = text.replace(/^\s*-\s+/gm, '- ')

  // Fix numbered lists
  fixed = fixed.replace(/^\s*(\d+)\.\s+/gm, '$1. ')

  // Fix headings that might have wrong spacing
  fixed = fixed.replace(/^#+\s+/gm, '## ')

  // Fix bolding that might be incorrect
  fixed = fixed.replace(/\*\*([^*]+)\*\*/g, '**$1**')

  // Remove any remaining markdown image syntax
  fixed = fixed.replace(/!\[[^\]]*\]\([^)]*\)/g, '')

  // Fix italic that might be incorrect
  fixed = fixed.replace(/\*([^*]+)\*/g, '*$1*')

  return fixed
}

/**
 * Generate simple formatted text as fallback
 */
async function generateSimpleFormattedText(extractedText, imageMarkdown = '') {
  try {
    // Add a delay before API call
    console.log(
      `Waiting ${API_DELAY / 1000} seconds before calling Gemini API...`
    )
    await delay(API_DELAY)

    const simplePrompt = `
      Reescribe este texto en español rioplatense, con una estructura clara y buena organización.
      IMPORTANTE: Usa estos elementos de formato markdown:
      1. Incluye al menos dos subtítulos usando ## Subtítulo
      2. OBLIGATORIO: Incluye al menos una lista de elementos con viñetas en este formato exacto:
         - Primer elemento
         - Segundo elemento
         - Tercer elemento
      3. Usa **negritas** para destacar información importante (al menos 3 veces)
      4. Si hay citas textuales, formátealas como > Texto citado
      
      ${
        imageMarkdown
          ? 'Incluye estas descripciones de imágenes en el texto:\n\n' +
            imageMarkdown
          : ''
      }
      
      Texto original: "${extractedText.substring(0, 3000)}"
    `

    const result = await model.generateContent(simplePrompt)
    const text = result.response.text()

    // Post-process to fix any remaining issues
    return postProcessText(text)
  } catch (error) {
    console.error('Error in simple text formatting:', error)
    return formatTextAsFallback(extractedText, imageMarkdown)
  }
}

/**
 * Format text using basic rules as a fallback when AI is unavailable
 */
function formatTextAsFallback(extractedText, imageMarkdown) {
  try {
    // Basic cleanup
    let text = extractedText.trim()

    // Break into paragraphs
    const paragraphs = text.split(/\n\s*\n/)

    // Format each paragraph
    const formattedParagraphs = paragraphs
      .filter((p) => p.trim().length > 0)
      .map((p) => p.trim())

    // Insert images at reasonable intervals if available
    let result = ''
    const images = imageMarkdown
      .split('\n\n')
      .filter((img) => img.trim().length > 0)

    // Add a basic heading
    result += '## Detalles principales\n\n'

    // If we have images, distribute them through the text
    if (images.length > 0) {
      const paragraphsPerImage = Math.max(
        Math.floor(formattedParagraphs.length / (images.length + 1)),
        1
      )

      let pointsAdded = false

      formattedParagraphs.forEach((paragraph, index) => {
        // Add a second heading midway through
        if (index === Math.floor(formattedParagraphs.length / 2)) {
          result += '## Información adicional\n\n'
        }

        // At 1/3 of the way through, add a bullet list if we haven't added one already
        if (
          !pointsAdded &&
          index === Math.floor(formattedParagraphs.length / 3)
        ) {
          // Extract some key points as bullets
          const sentences = paragraph
            .split(/[.!?]+/)
            .filter((s) => s.trim().length > 5)
            .slice(0, 3)
          if (sentences.length > 1) {
            result += 'Puntos destacados:\n\n'
            sentences.forEach((sentence) => {
              result += `- ${sentence.trim()}\n`
            })
            result += '\n'
            pointsAdded = true
          } else {
            // If we can't extract sentences, create a simple list from the paragraph
            result += 'Puntos destacados:\n\n'
            result +=
              '- **Punto importante:** ' +
              paragraph.substring(0, 80).trim() +
              '\n'
            result +=
              '- **Información adicional:** Datos relevantes sobre el tema\n'
            result +=
              '- **Contexto:** Elementos adicionales para comprender la noticia\n\n'
            pointsAdded = true
          }
        } else {
          result += paragraph + '\n\n'
        }

        // Insert an image description after certain paragraphs
        if (images.length > 0 && (index + 1) % paragraphsPerImage === 0) {
          result += images.shift() + '\n\n'
        }
      })

      // Add any remaining images at the end
      if (images.length > 0) {
        result += images.join('\n\n')
      }
    } else {
      // No images, add headings and bullet points
      const firstThird = Math.floor(formattedParagraphs.length / 3)
      const secondThird = Math.floor((formattedParagraphs.length * 2) / 3)

      // Ensure we always have a list somewhere
      let listAdded = false

      formattedParagraphs.forEach((paragraph, index) => {
        if (index === firstThird) {
          result += '## Detalles relevantes\n\n'

          // Extract some key points as bullets
          const sentences = paragraph
            .split(/[.!?]+/)
            .filter((s) => s.trim().length > 5)
            .slice(0, 3)
          if (sentences.length > 1) {
            result += 'Puntos destacados:\n\n'
            sentences.forEach((sentence) => {
              result += `- ${sentence.trim()}\n`
            })
            result += '\n'
            listAdded = true
          } else {
            result += paragraph + '\n\n'
          }
        } else if (index === secondThird) {
          result += '## Información adicional\n\n'

          // If we haven't added a list yet, add one here
          if (!listAdded) {
            result += 'Aspectos clave:\n\n'
            result +=
              '- **Información principal:** ' +
              paragraph.substring(0, 80).trim() +
              '\n'
            result +=
              '- **Dato relevante:** Información adicional sobre el tema\n'
            result +=
              '- **Contexto importante:** Elementos para comprender mejor la noticia\n\n'
            listAdded = true
          } else {
            result += paragraph + '\n\n'
          }
        } else {
          result += paragraph + '\n\n'
        }
      })

      // If we still haven't added a list, add one at the end
      if (!listAdded) {
        result += '## Resumen de puntos clave\n\n'
        result +=
          '- **Tema principal:** La noticia trata sobre ' +
          formattedParagraphs[0].substring(0, 60).trim() +
          '\n'
        result +=
          '- **Información destacada:** Elementos relevantes del artículo\n'
        result +=
          '- **Contexto:** Datos complementarios para entender la situación\n\n'
      }
    }

    return result
  } catch (error) {
    console.error('Error in fallback text formatting:', error.message)
    // Return a minimal version if even the fallback fails
    return extractedText
  }
}

/**
 * Generate fallback metadata when AI is unavailable
 */
function generateFallbackMetadata(extractedText) {
  try {
    // Simple rule-based title extraction
    const paragraphs = extractedText
      .split(/\n+/)
      .filter((p) => p.trim().length > 0)

    // Get first paragraph that's at least 20 chars
    const firstPara =
      paragraphs.find((p) => p.trim().length >= 20) || paragraphs[0] || ''

    // Use first sentence as title (up to 80 chars)
    const firstSentence =
      firstPara.split(/[.!?]/).filter((s) => s.trim().length > 0)[0] || ''
    const title = firstSentence.trim().substring(0, 80)

    // Use second paragraph as bajada (up to 200 chars)
    const secondPara = paragraphs[1] || paragraphs[0] || ''
    const bajada = secondPara.trim().substring(0, 200)

    // Simple volanta based on content
    let volanta = ''

    // Try to detect a category from the text
    if (extractedText.match(/deport[eias]/i)) volanta = 'Deportes'
    else if (extractedText.match(/econom[íia]/i)) volanta = 'Economía'
    else if (extractedText.match(/politic[ao]/i)) volanta = 'Política'
    else if (extractedText.match(/entreten|espectácul|celebr|artista/i))
      volanta = 'Espectáculos'
    else if (extractedText.match(/tecnolog[íia]/i)) volanta = 'Tecnología'
    else volanta = 'Noticias'

    return {
      title: title || 'Artículo sin título',
      bajada: bajada || 'Sin descripción disponible',
      volanta: volanta,
    }
  } catch (error) {
    console.error('Error in fallback metadata generation:', error.message)
    return {
      title: 'Artículo sin título',
      bajada: 'Sin descripción disponible',
      volanta: 'Noticias',
    }
  }
}

/**
 * Generates metadata for an article with retry logic and fallback
 */
async function generateMetadata(extractedText, maxRetries = 5) {
  let retries = 0
  while (retries < maxRetries) {
    try {
      // Add a longer delay with exponential backoff
      const delayTime = API_DELAY * Math.pow(1.5, retries)
      console.log(
        `Waiting ${delayTime / 1000} seconds before generating metadata...`
      )
      await delay(delayTime)

      const prompt = `
        Extracted Text: "${extractedText.substring(0, 5000)}"
        
        Basado en el texto anterior, genera lo siguiente:
        1. Un título conciso y atractivo. **No uses mayúsculas en todas las palabras** (evita el title case). Solo usa mayúsculas al principio del título y en nombres propios. ESTO ES MUY IMPORTANTE Y HAY QUE RESPETARLO A RAJATABLA.
        2. Un resumen (bajada) de 40 a 50 palabras que capture los puntos clave. **No uses mayúsculas en todas las palabras**. Solo usa mayúsculas al principio de cada oración y en nombres propios.
        3. Una volanta corta que brinde contexto o destaque la importancia del artículo. **No uses mayúsculas en todas las palabras**. Solo usa mayúsculas al principio y en nombres propios.
        
        Return the output in JSON format:
        {
          "title": "Generated Title",
          "bajada": "Generated 40-50 word summary",
          "volanta": "Generated overline"
        }
      `

      const result = await model.generateContent(prompt)
      const response = await result.response
      const text = response.text()

      const cleanedText = text
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim()

      return JSON.parse(cleanedText)
    } catch (error) {
      if (error.message && error.message.includes('429')) {
        const waitTime = Math.pow(2, retries) * 1000
        console.warn(
          `Rate limit exceeded. Retrying in ${waitTime / 1000} seconds...`
        )
        await delay(waitTime)
        retries++
      } else if (
        error.message &&
        (error.message.includes('503') ||
          error.message.includes('Service Unavailable'))
      ) {
        console.error(
          `Gemini service unavailable. Using fallback metadata extraction...`
        )
        return generateFallbackMetadata(extractedText)
      } else {
        console.error(`Error generating metadata:`, error.message)

        if (retries >= 2) {
          console.warn('Multiple failures, using fallback metadata')
          return generateFallbackMetadata(extractedText)
        }

        retries++
        await delay(3000)
      }
    }
  }

  console.error(
    'Max retries reached. Unable to generate metadata. Using fallback.'
  )
  return generateFallbackMetadata(extractedText)
}

/**
 * Reelaborates article text using AI with fallback mechanism
 */
async function reelaborateText(
  extractedText,
  imageMarkdown = '',
  maxRetries = 5
) {
  let retries = 0
  while (retries < maxRetries) {
    try {
      // Add a longer delay with exponential backoff
      const delayTime = API_DELAY * Math.pow(1.5, retries)
      console.log(
        `Waiting ${delayTime / 1000} seconds before reelaborating text...`
      )
      await delay(delayTime)

      // Add image markdown content if available
      const imagesPrompt = imageMarkdown
        ? 'Las siguientes descripciones de imágenes fueron extraídas del artículo original. Intégralas en el texto reelaborado en los lugares más apropiados según el contexto:\n\n' +
          imageMarkdown
        : ''

      const prompt = `
        Reelaborar la siguiente noticia siguiendo estas pautas:

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
           - OBLIGATORIO: Dividir el texto en secciones con subtítulos claros usando formato markdown (## Subtítulo).
           - OBLIGATORIO: Utilizar al menos 2-3 subtítulos en formato H2 (##) para dividir el texto en secciones temáticas.
           - Organizar la información en párrafos cortos y bien estructurados.
           - Concluir sin añadir interpretaciones o valoraciones. Está prohibido usar títulos y expresiones explícitos como "en resumen", "conclusión", "en conclusión", "en resumen", "en síntesis" o similares.
        
        5. **Sintaxis y Visualidad**:
           - OBLIGATORIO: Usar oraciones cortas y directas para facilitar la lectura.
           - OBLIGATORIO: Incorporar elementos visuales como:
             - OBLIGATORIO: INCLUIR AL MENOS UNA LISTA con viñetas para enumerar puntos clave. Usar este formato exacto:
               - Primer punto clave
               - Segundo punto clave 
               - Tercer punto clave
             - OBLIGATORIO: Usar **negritas** para resaltar información importante.
             - OBLIGATORIO: Si hay citas textuales, usar el formato de cita: > Cita textual
           - OBLIGATORIO: Si la noticia menciona una serie de pasos o elementos, formatearlos como lista numerada:
             1. Primer elemento
             2. Segundo elemento
             3. Tercer elemento
        
        6. **Formato Markdown**: 
           - ABSOLUTAMENTE OBLIGATORIO: Usar correctamente estos elementos de formato markdown:
             - Subtítulos: ## Subtítulo (al menos 2 subtítulos)
             - OBLIGATORIO: Incluir al menos una lista con viñetas usando este formato exacto:
               - Primer elemento
               - Segundo elemento
               - Tercer elemento
             - Negritas: **texto importante** (usar en al menos 3 lugares)
             - Cursivas: *texto en cursiva* (usar al menos una vez)
             - Citas: > Texto citado (si hay citas en el texto original)
        
        7. **Imágenes**: 
           - Incluir las descripciones de imágenes proporcionadas en el texto.
           - Simplemente insertar el texto de la imagen (que ya está formateado) en un lugar relevante.
        
        8. **Fuentes**:
           - Si la noticia original incluye fuentes o referencias, asegurarse de citarlas correctamente.
           - Si no hay fuentes, evitar especulaciones o suposiciones.
        
        9. **Formato de Salida**:
           - Devolver la noticia reelaborada ÚNICAMENTE en formato Markdown.
           - NO incluir backticks (\`\`\`) ni indicar que es un bloque de markdown.
        
        10. **Palabras Estrictamente Prohibidas**: Las siguiente palabras no deben aparecer en ninguna parte del texto: fusionar - fusionándose - reflejar - reflejándose - sumergir - sumergirse - en resumen - conclusión - en síntesis - markdown

        11. **Títulos**: No incluir un título principal (# Título) en el artículo bajo ninguna circunstancia. El título ya está generado en otro campo del registro de Airtable, por lo que no es necesario repetirlo en el contenido. IMPORTANTE: Comenzar directamente con el cuerpo del texto.
        
        12. **IMPORTANTE - VERIFICACIÓN FINAL**:
           - Antes de enviar tu respuesta, verifica que:
             1. Has incluido al menos 2 subtítulos (## Subtítulo)
             2. Has incluido al menos 1 lista con viñetas (- Elemento)
             3. Has usado negritas (**texto**) en al menos 3 lugares
             4. No has usado símbolos extraños o caracteres que podrían verse mal
           - Si falta alguno de estos elementos, agrégalo antes de enviar.
        
        ${imagesPrompt}
        
        Texto extraído: "${extractedText.substring(0, 5000)}"
      `

      const result = await model.generateContent(prompt)
      const response = await result.response
      let text = response.text()

      // Check if text has proper formatting - require at least one ## heading and one list
      const hasHeadings = text.includes('## ')
      const hasList = text.includes('- ')

      if (!hasHeadings || !hasList) {
        console.warn('Generated text is missing proper formatting, retrying...')
        retries++
        continue
      }

      // Post-process to fix any remaining issues
      text = postProcessText(text)

      return text
    } catch (error) {
      if (error.message && error.message.includes('429')) {
        const waitTime = Math.pow(2, retries) * 1000
        console.warn(
          `Rate limit exceeded. Retrying in ${waitTime / 1000} seconds...`
        )
        await delay(waitTime)
        retries++
      } else if (
        error.message &&
        (error.message.includes('503') ||
          error.message.includes('Service Unavailable'))
      ) {
        console.error(
          `Gemini service unavailable. Trying alternative approach...`
        )

        // Try simpler formatting first
        try {
          return await generateSimpleFormattedText(extractedText, imageMarkdown)
        } catch (simpleError) {
          // If that fails too, use the basic fallback
          console.error('Simple formatting failed:', simpleError.message)
          return formatTextAsFallback(extractedText, imageMarkdown)
        }
      } else {
        console.error(`Error reelaborating text:`, error.message)

        // If we've already retried several times, use the fallback
        if (retries >= 2) {
          console.warn('Multiple failures, using fallback text formatting')
          try {
            return await generateSimpleFormattedText(
              extractedText,
              imageMarkdown
            )
          } catch (e) {
            return formatTextAsFallback(extractedText, imageMarkdown)
          }
        }

        retries++
        await delay(3000) // Wait a bit before retrying
      }
    }
  }

  console.error(
    'Max retries reached. Unable to reelaborate text. Using fallback formatting.'
  )
  return formatTextAsFallback(extractedText, imageMarkdown)
}

/**
 * Processes a single article
 */
async function processArticle(item, sectionId) {
  try {
    console.log(`Processing article: ${item.url} for section ${sectionId}`)

    // Fetch and extract content
    const htmlContent = await fetchContent(item.url)
    if (!htmlContent) {
      console.warn(`Failed to fetch content for URL: ${item.url}`)
      return null
    }

    // Extract images and convert to markdown
    const { images, markdown: imageMarkdown } =
      extractImagesAsMarkdown(htmlContent)
    console.log(`Found ${images.length} images in article: ${item.url}`)

    const extractedText = extractText(htmlContent)
    if (!extractedText || extractedText.length < 50) {
      console.warn(`Insufficient content for URL: ${item.url}`)
      return null
    }

    // Extract embeds using the imported services
    const instagramContent = embeds.extractInstagramEmbeds(htmlContent)
    const facebookContent = embeds.extractFacebookEmbeds(htmlContent)
    const twitterContent = embeds.extractTwitterEmbeds(htmlContent)
    const youtubeContent = embeds.extractYoutubeEmbeds(htmlContent)

    // Log found embeds
    const embedsFound = {
      instagram: !!instagramContent,
      facebook: !!facebookContent,
      twitter: !!twitterContent,
      youtube: !!youtubeContent,
    }
    console.log(`Found embeds for ${item.url}:`, embedsFound)

    // Reelaborate text WITH image markdown
    console.log(`Reelaborating text for: ${item.url}`)
    let reelaboratedText = null
    try {
      reelaboratedText = await reelaborateText(extractedText, imageMarkdown)
    } catch (textError) {
      console.error(`Error reelaborating text: ${textError.message}`)
      console.warn(`Failed to reelaborate text for URL: ${item.url}`)
      // Use original text as fallback
      reelaboratedText = formatTextAsFallback(extractedText, imageMarkdown)
    }

    if (!reelaboratedText) {
      reelaboratedText = formatTextAsFallback(extractedText, imageMarkdown)
      console.warn(`Using fallback formatting for: ${item.url}`)
    }

    // Generate metadata
    console.log(`Generating metadata for: ${item.url}`)
    let metadata = null
    try {
      metadata = await generateMetadata(extractedText)
    } catch (metaError) {
      console.error(`Error generating metadata: ${metaError.message}`)
      // Use fallback metadata
      metadata = generateFallbackMetadata(extractedText)
    }

    if (!metadata) {
      metadata = generateFallbackMetadata(extractedText)
      console.warn(`Using fallback metadata for: ${item.url}`)
    }

    // Generate tags
    console.log(`Generating tags for: ${item.url}`)
    let tags = ''
    try {
      tags = await generateTags(extractedText, metadata)
      console.log(`Generated tags for: ${item.url}`)
    } catch (tagError) {
      console.error(`Error generating tags: ${tagError.message}`)
      tags = generateFallbackTags(extractedText, metadata)
    }

    // Generate social media text
    console.log(`Generating social media text for: ${item.url}`)
    let socialMediaText = ''
    try {
      socialMediaText = await generateSocialMediaText(
        extractedText,
        metadata,
        tags
      )
      console.log(
        `Generated social media text: ${socialMediaText.length} chars`
      )
    } catch (socialTextError) {
      console.error(
        `Error generating social media text: ${socialTextError.message}`
      )
      socialMediaText = generateFallbackSocialText(metadata, tags)
    }

    // Get section information
    const section = getSection(sectionId)

    // Prepare record
    const attachments = item.attachments || []
    const attachmentUrls = attachments.map((attachment) => attachment.url)
    const imgUrl = [...attachmentUrls].filter(Boolean).join(', ')

    // Clean the reelaborated text using postProcessText
    const processedText = postProcessText(reelaboratedText)

    // Format image URLs as attachment objects for Airtable
    let imageAttachments = []
    if (images.length > 0) {
      imageAttachments = images.map((url) => ({ url }))
    } else if (imgUrl) {
      imageAttachments = [{ url: imgUrl }]
    }

    // Create a dynamic mapping of Supabase section IDs to Airtable values
    const sectionIdToAirtableValue = {
      'coronel-suarez': 'Coronel Suárez',
      'pueblos-alemanes': 'Pueblos Alemanes',
      huanguelen: 'Huanguelén',
      'la-sexta': 'La Sexta',
      politica: 'Política',
      economia: 'Economía',
      agro: 'Agro',
      sociedad: 'Sociedad',
      salud: 'Salud',
      cultura: 'Cultura',
      opinion: 'Opinión',
      deportes: 'Deportes',
      lifestyle: 'Lifestyle',
      vinos: 'Vinos',
      'el-recetario': 'El Recetario',
      'santa-trinidad': 'Santa Trinidad',
      'san-jose': 'San José',
      'santa-maria': 'Santa María',
      iactualidad: 'IActualidad',
      dolar: 'Dólar',
      propiedades: 'Propiedades',
      'pymes-emprendimientos': 'Pymes y Emprendimientos',
      inmuebles: 'Inmuebles',
      campos: 'Campos',
      'construccion-diseno': 'Construcción y Diseño',
      agricultura: 'Agricultura',
      ganaderia: 'Ganadería',
      'tecnologias-agro': 'Tecnologías',
      educacion: 'Educación',
      policiales: 'Policiales',
      efemerides: 'Efemérides',
      ciencia: 'Ciencia',
      'vida-armonia': 'Vida en Armonía',
      'nutricion-energia': 'Nutrición y Energía',
      fitness: 'Fitness',
      'salud-mental': 'Salud Mental',
      turismo: 'Turismo',
      horoscopo: 'Horóscopo',
      feriados: 'Feriados',
      'loterias-quinielas': 'Loterías y Quinielas',
      'moda-belleza': 'Moda y Belleza',
      mascotas: 'Mascotas',
    }

    // Replace the hardcoded section mapping with this more dynamic lookup
    // Default to empty string as requested
    const sectionValue = sectionIdToAirtableValue[sectionId] || ''

    // Look up the section in our mapping
    if (sectionIdToAirtableValue[sectionId]) {
      sectionValue = sectionIdToAirtableValue[sectionId]
    }

    // Extract source name from the URL
    const sourceName = extractSourceName(item.url)
    console.log(`Extracted source name: ${sourceName} from URL: ${item.url}`)

    const recordFields = {
      title: metadata ? metadata.title : item.title,
      overline: metadata ? metadata.volanta : 'No overline available.',
      excerpt: metadata ? metadata.bajada : 'No summary available.',
      article: processedText,
      image: imageAttachments, // Array of attachment objects for Airtable
      imgUrl: imgUrl || (images.length > 0 ? images[0] : ''),
      'article-images': images.join(', '),
      url: item.url,
      source: sourceName, // Add the extracted source name
      'ig-post': instagramContent || '',
      'fb-post': facebookContent || '',
      'tw-post': twitterContent || '',
      'yt-video': youtubeContent || '',
      section: sectionValue, // Using exact dropdown value from Airtable options
      status: 'draft',
      tags: tags,
      socialMediaText: socialMediaText, // Using exact dropdown value 'draft' instead of 'Borrador'
      front: '', // Default to empty (no front page section assigned)
      order: '', // Default to empty (no specific display order assigned)
    }

    console.log(
      `Successfully processed article: ${item.url} for section ${sectionId}`
    )

    return {
      fields: recordFields,
    }
  } catch (error) {
    console.error(`Error processing article ${item.url}:`, error.message)
    return null
  }
}

/**
 * Processes a batch of articles
 */
async function processBatch(items, sectionId) {
  console.log(
    `Processing batch of ${items.length} items for section ${sectionId}`
  )

  const results = []
  // Get state for this section
  const state = loadSectionState(sectionId)
  const processedUrls = new Set(state.processedUrls || [])

  // Process articles sequentially to avoid rate limits
  for (const item of items) {
    console.log(`Processing article: ${item.url}`)
    const result = await processArticle(item, sectionId)
    if (result) {
      results.push(result)
      // Mark URL as processed
      processedUrls.add(item.url)
    }

    // Update section state after each item
    saveSectionState(sectionId, {
      processedUrls: [...processedUrls],
      lastRun: new Date().toISOString(),
    })

    // Add a longer delay between processing individual items
    console.log(
      `Waiting ${API_DELAY / 1000} seconds before processing next article...`
    )
    await delay(API_DELAY)
  }

  console.log(
    `Successfully processed ${results.length} out of ${items.length} items for section ${sectionId}`
  )
  return results
}

/**
 * Processes a section
 */
async function processSection(section) {
  console.log(`\n=== Processing section: ${section.name} ===\n`)

  // Special handling for Instituciones social media content
  if (section.id === 'instituciones') {
    console.log(`Processing ${section.name} as social media content...`)

    try {
      // Load state for this section
      const state = loadSectionState(section.id)
      const processedUrls = new Set(state.processedUrls || [])

      // Fetch feed data
      console.log(`Fetching social media feed for ${section.name}`)
      const response = await axios.get(section.rssUrl)
      const feedData = response.data

      if (!feedData || !feedData.items || !Array.isArray(feedData.items)) {
        console.warn(`No valid items in feed data for ${section.name}`)
        return
      }

      console.log(
        `Fetched ${feedData.items.length} items from ${section.name} feed`
      )
      console.log(`Already processed ${processedUrls.size} items previously`)

      // Filter out already processed items unless force flag is used
      const newItems = args.force
        ? feedData.items.slice(0, FEED_SIZE)
        : feedData.items
            .filter((item) => !processedUrls.has(item.url))
            .slice(0, FEED_SIZE)

      if (newItems.length === 0) {
        console.log(
          `No new items to process for ${section.name}${
            args.force ? ' (even with force flag)' : ''
          }`
        )
        return
      }

      console.log(
        `Found ${newItems.length} ${
          args.force ? '' : 'new '
        }items to process for ${section.name}`
      )

      // Apply the limit
      const limitedItems = newItems.slice(0, ITEM_LIMIT)
      console.log(
        `Processing ${limitedItems.length} social media items (limit: ${ITEM_LIMIT})`
      )

      // Process the limited items
      for (const item of limitedItems) {
        try {
          const itemUrl = item.url || ''
          console.log(
            `Processing social media item: ${
              item.title || 'Untitled'
            } (${itemUrl})`
          )

          // IMPROVED: Extract all content directly from the RSS feed item structure
          // This matches the expected format you provided

          // Extract post text content from content_text field (primary source)
          const postText = item.content_text || ''

          // Get image URL (primary source is the image field)
          let imageUrl = item.image || null

          // If main image is missing, check attachments
          if (!imageUrl && item.attachments && item.attachments.length > 0) {
            imageUrl = item.attachments[0].url
          }

          // Determine source platform from URL
          let sourceName = 'Social Media'
          let socialMediaType = ''

          try {
            const hostname = new URL(itemUrl).hostname
            if (hostname.includes('facebook.com')) {
              sourceName = 'Facebook'
              socialMediaType = 'fb-post'
            } else if (hostname.includes('instagram.com')) {
              sourceName = 'Instagram'
              socialMediaType = 'ig-post'
            } else if (
              hostname.includes('twitter.com') ||
              hostname.includes('x.com')
            ) {
              sourceName = 'Twitter'
              socialMediaType = 'tw-post'
            } else if (
              hostname.includes('youtube.com') ||
              hostname.includes('youtu.be')
            ) {
              sourceName = 'YouTube'
              socialMediaType = 'yt-video'
            } else {
              // Get domain without www. prefix for other sources
              const domain = hostname.replace(/^www\./, '')
              const parts = domain.split('.')
              if (parts.length >= 2) {
                sourceName =
                  parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
              }
            }
          } catch (e) {
            console.log(
              `Error parsing URL: ${e.message}. Using default source name.`
            )
            // URL parsing failed, check if we can extract from authors
            if (
              item.authors &&
              item.authors.length > 0 &&
              item.authors[0].name
            ) {
              sourceName = item.authors[0].name
            }
          }

          // Get author information
          const authorName =
            item.authors && item.authors.length > 0
              ? item.authors[0].name
              : sourceName

          // Format publication date if available
          let pubDate = ''
          try {
            if (item.date_published) {
              const date = new Date(item.date_published)
              pubDate = date.toLocaleDateString('es-AR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })
            }
          } catch (e) {
            console.log(`Error formatting date: ${e.message}`)
          }

          // Create record fields
          const recordFields = {
            title: item.title || `Publicación de ${sourceName}`,
            url: itemUrl,
            excerpt: postText.substring(0, 200), // First 200 chars as excerpt
            source: sourceName,
            imgUrl: imageUrl || '',
            article: postText, // Store the full post text
            overline: item.overline || '', // Use author name as volanta
            status: 'draft',
            processingStatus: 'completed', // Mark as completed since we have the full text already
            postDate: item.date_published || '',
            postDateFormatted: pubDate,
            // Add this line to create proper image attachments:
            image: imageUrl ? [{ url: imageUrl }] : [],
          }

          // Generate tags and social media text for social media content
          try {
            // For social media, use a simpler approach focused on the source and text
            const socialText = `${item.title || ''} ${postText}`
            const socialMetadata = {
              title: item.title || `Publicación de ${sourceName}`,
              bajada: postText.substring(0, 200),
              sourceName: sourceName,
            }

            // Generate tags
            const tags = await generateTags(socialText, socialMetadata)
            console.log(`Generated tags for social media item`)
            recordFields.tags = tags

            // Generate social media text
            const socialMediaText = await generateSocialMediaText(
              socialText,
              socialMetadata,
              tags
            )
            console.log(
              `Generated social media text: ${socialMediaText.length} chars`
            )
            recordFields.socialMediaText = socialMediaText
          } catch (genError) {
            console.error(
              `Error generating tags/social text: ${genError.message}`
            )
            recordFields.tags = sourceName
            recordFields.socialMediaText = `📱 Nueva publicación de ${sourceName} #${sourceName.replace(
              /\s+/g,
              ''
            )}`
          }

          // Add social media specific fields based on source type
          if (socialMediaType) {
            recordFields[socialMediaType] = itemUrl
          }

          // Add HTML content if available (useful for embedding or further processing)
          if (item.content_html) {
            recordFields.contentHtml = item.content_html
          }

          // Add post ID if available
          if (item.id) {
            recordFields.postId = item.id
          }

          // Insert into Airtable
          try {
            await airtableService.insertRecords(
              [{ fields: recordFields }],
              section.id
            )
            console.log(
              `Added social media item to Airtable: ${recordFields.title}`
            )

            // Mark URL as processed
            processedUrls.add(itemUrl)

            // Update section state after each item
            saveSectionState(section.id, {
              processedUrls: [...processedUrls],
              lastRun: new Date().toISOString(),
            })
          } catch (airtableError) {
            console.error(
              `Error adding item to Airtable: ${airtableError.message}`
            )
          }

          // Add a delay to avoid rate limits
          await delay(API_DELAY)
        } catch (itemError) {
          console.error(
            `Error processing social media item: ${itemError.message}`
          )
        }
      }

      console.log(`Completed processing ${section.name} content`)
      return // Skip the regular article processing
    } catch (error) {
      console.error(`Error processing section ${section.name}:`, error.message)
    }

    // If we reach here, something went wrong with Instituciones processing
    return
  }

  // Load state for this section
  const state = loadSectionState(section.id)
  const processedUrls = new Set(state.processedUrls || [])

  try {
    console.log(`Starting feed processing for ${section.name}`)

    // Fetch feed data
    const response = await axios.get(section.rssUrl)
    const feedData = response.data

    if (!feedData || !feedData.items || !Array.isArray(feedData.items)) {
      console.warn(`No valid items in feed data for ${section.name}`)
      return
    }

    console.log(
      `Fetched ${feedData.items.length} items from ${section.name} feed`
    )
    console.log(`Already processed ${processedUrls.size} items previously`)

    // Filter out already processed items UNLESS force flag is used
    const newItems = args.force
      ? feedData.items.slice(0, FEED_SIZE)
      : feedData.items
          .filter((item) => !processedUrls.has(item.url))
          .slice(0, FEED_SIZE)

    if (newItems.length === 0) {
      console.log(
        `No new items to process for ${section.name}${
          args.force ? ' (even with force flag)' : ''
        }`
      )
      return
    }

    console.log(
      `Found ${newItems.length} ${
        args.force ? '' : 'new '
      }items to process for ${section.name}`
    )

    // Apply the limit
    const limitedItems = newItems.slice(0, ITEM_LIMIT)
    console.log(
      `Processing ${limitedItems.length} items (limit: ${ITEM_LIMIT})`
    )

    // Process the limited items instead of all items
    for (let i = 0; i < limitedItems.length; i += BATCH_SIZE) {
      const batchItems = limitedItems.slice(i, i + BATCH_SIZE)
      console.log(
        `\n=== Processing batch ${
          Math.floor(i / BATCH_SIZE) + 1
        } of ${Math.ceil(limitedItems.length / BATCH_SIZE)} for ${
          section.name
        } ===\n`
      )

      const processedBatch = await processBatch(batchItems, section.id)

      if (processedBatch.length > 0) {
        // Insert into Airtable with section ID
        try {
          await airtableService.insertRecords(processedBatch, section.id)
          console.log(
            `Inserted ${processedBatch.length} records into ${section.name} Airtable table`
          )
        } catch (error) {
          console.error(
            `Error inserting records into ${section.name} Airtable:`,
            error.message
          )
        }
      }

      // Add a longer delay between batches
      if (i + BATCH_SIZE < limitedItems.length) {
        console.log(
          `Waiting ${
            BATCH_DELAY / 1000
          } seconds before processing next batch...`
        )
        await delay(BATCH_DELAY)
      }
    }

    console.log(`\n=== Completed processing for section: ${section.name} ===\n`)
  } catch (error) {
    console.error(`Error processing section ${section.name}:`, error.message)
  }
}

/**
 * Process all requested sections
 */
async function processAllRequestedSections() {
  try {
    console.log('Starting processing for all requested sections')

    // Sort sections by priority (lower number = higher priority)
    const sortedSections = [...sectionsToProcess].sort(
      (a, b) => a.priority - b.priority
    )

    // Process each section sequentially
    for (const section of sortedSections) {
      await processSection(section)

      // Add a longer delay between sections
      if (section !== sortedSections[sortedSections.length - 1]) {
        console.log(
          `\nWaiting ${
            SECTION_DELAY / 1000
          } seconds before processing next section...\n`
        )
        await delay(SECTION_DELAY)
      }
    }

    console.log('\n=== All section processing complete ===')
  } catch (error) {
    console.error('Error in processing sections:', error.message)
  }
}

// Look for a function like fetchFeed or getFeedItems

async function fetchFeed(feedUrl) {
  // Existing code to fetch and parse the feed...

  // After you have the items array, apply the limit
  const limitedItems = items.slice(0, ITEM_LIMIT)
  console.log(
    `Fetched ${items.length} items, returning ${limitedItems.length} (limit: ${ITEM_LIMIT})`
  )

  return limitedItems // Return limited items
}

// Look for any functions with maxItems, limit, or similar parameters

// For example:
async function fetchSourceItems(source, maxItems) {
  // If the function already has a maxItems parameter,
  // make sure it's respecting the global limit
  const effectiveLimit = maxItems || ITEM_LIMIT

  // Use effectiveLimit in your code...
}

// Near the end of your file where the main execution happen

// If --all flag is specified, process all sections
if (args.all) {
  console.log(
    'Processing all sections with limit:',
    ITEM_LIMIT === Infinity ? 'No limit' : ITEM_LIMIT
  )
  const allSections = getSections()
  for (const section of allSections) {
    await processSection(section) // This will use the ITEM_LIMIT
  }
  process.exit(0)
}

// Process specific section if provided
const sectionName = args._[0]
if (sectionName) {
  console.log(
    `Processing section: ${sectionName} with limit:`,
    ITEM_LIMIT === Infinity ? 'No limit' : ITEM_LIMIT
  )
  const section = getSection(sectionName)
  if (section) {
    await processSection(section) // This will use the ITEM_LIMIT
  } else {
    console.error(`Section not found: ${sectionName}`)
  }
  process.exit(0)
}

// Start processing
processAllRequestedSections()
  .then(() => console.log('Process completed'))
  .catch((error) => console.error('Process failed:', error.message))

/**
 * Extract source name from URL dynamically without hardcoding
 * @param {string} url - The article URL
 * @returns {string} - The extracted source name
 */
function extractSourceName(url) {
  try {
    if (!url) return 'Unknown Source'

    // Parse the URL to get the hostname
    const hostname = new URL(url).hostname

    // Step 1: Remove common prefixes
    let domain = hostname
      .replace(/^www\./, '')
      .replace(/^m\./, '')
      .replace(/^mobile\./, '')
      .replace(/^news\./, '')
      .replace(/^noticias\./, '')

    // Step 2: Handle social media separately
    if (domain.includes('facebook.com')) return 'Facebook'
    if (domain.includes('instagram.com')) return 'Instagram'
    if (domain.includes('twitter.com') || domain.includes('x.com'))
      return 'Twitter'
    if (domain.includes('youtube.com') || domain.includes('youtu.be'))
      return 'YouTube'
    if (domain.includes('tiktok.com')) return 'TikTok'
    if (domain.includes('linkedin.com')) return 'LinkedIn'
    if (domain.includes('t.co')) return 'Twitter'

    // Step 3: Strip common TLDs and country codes
    domain = domain.replace(
      /\.(com|co|net|org|info|ar|mx|es|cl|pe|br|uy|py|bo|ec|ve|us|io|tv|app|web|digital|news|online|press|media|blog|site)(\.[a-z]{2,3})?$/,
      ''
    )

    // Step 4: Split by dots and get the main part
    const parts = domain.split('.')
    let sourceName = parts[0]

    // Step 5: Handle special cases like clarin.com.ar -> Clarín
    const domainMapping = {
      lanacion: 'La Nación',
      eldiario: 'El Diario',
      pagina12: 'Página 12',
      larazon: 'La Razón',
      lavoz: 'La Voz',
      eleconomista: 'El Economista',
      elpais: 'El País',
      ole: 'Olé',
      ambito: 'Ámbito',
      telam: 'Télam',
      infobae: 'Infobae',
      eldestape: 'El Destape',
      cronista: 'El Cronista',
      tiempoar: 'Tiempo Argentino',
      tn: 'Todo Noticias',
    }

    if (domainMapping[sourceName]) {
      return domainMapping[sourceName]
    }

    // Step 6: Handle compound domains (remove dashes/underscores and capitalize words)
    return sourceName
      .split(/[-_]/)
      .map((word) => {
        // Special case for single-letter words like "c" in "c5n"
        if (word.length === 1) return word.toUpperCase()

        // Proper capitalization for normal words
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      })
      .join(' ')
  } catch (error) {
    console.error(`Error extracting source name from ${url}:`, error.message)
    return 'Unknown Source'
  }
}

/**
 * Generate tags for an article using AI
 * @param {string} extractedText - The raw text content
 * @param {object} metadata - The article metadata (title, bajada, etc.)
 * @returns {string} - Comma-separated list of generated tags
 */
async function generateTags(extractedText, metadata, maxRetries = 3) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      // Add delay with exponential backoff
      const delayTime = API_DELAY * Math.pow(1.5, retries);
      console.log(`Waiting ${delayTime / 1000} seconds before generating tags...`);
      await delay(delayTime);

      const title = metadata?.title || '';
      const bajada = metadata?.bajada || '';
      
      const prompt = `
        Analiza este artículo y genera entre 5 y 8 etiquetas (tags) relevantes para categorizarlo.

        TÍTULO: ${title}
        BAJADA: ${bajada}
        CONTENIDO: "${extractedText.substring(0, 4000)}"
        
        INSTRUCCIONES:
        1. Identifica nombres propios importantes (personas, lugares, organizaciones, eventos).
        2. Identifica temas principales y subtemas.
        3. Prioriza sustantivos y conceptos clave.
        4. Cada etiqueta debe tener entre 1 y 3 palabras.
        5. NO utilices hashtags (#).
        6. Enfócate en sujetos y temas, NO en adjetivos o emociones.
        7. Las etiquetas deben ser específicas pero no demasiado largas.
        8. Las etiquetas pueden ser en singular o plural, según corresponda.
        9. NO incluyas palabras muy genéricas como "noticia", "actualidad", etc.
        
        Devuelve SOLO un array de strings en formato JSON, sin ningún otro texto:
        ["etiqueta1", "etiqueta2", "etiqueta3", ...]
      `;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      // Clean up the response - extract just the JSON array
      const jsonMatch = text.match(/\[.*?\]/s);
      if (!jsonMatch) {
        throw new Error('No valid JSON array found in response');
      }
      
      const cleanedJson = jsonMatch[0].replace(/```json|```/g, '').trim();
      const tags = JSON.parse(cleanedJson);
      
      // Validate tags
      if (!Array.isArray(tags) || tags.length === 0) {
        throw new Error('Generated tags are not in expected format');
      }
      
      // Format tags: capitalize first letter of each word
      const formattedTags = tags.map(tag => 
        tag.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
      );
      
      // Join tags with commas to create a string
      const tagsString = formattedTags.join(', ');
      
      console.log(`Generated tags: ${tagsString}`);
      return tagsString;
    } catch (error) {
      console.error(`Error generating tags (attempt ${retries + 1}):`, error.message);
      retries++;
      
      if (retries >= maxRetries) {
        // Return basic fallback tags
        console.warn('Using fallback tag generation');
        return generateFallbackTags(extractedText, metadata);
      }
      
      await delay(2000); // Wait before retrying
    }
  }
  
  return ''; // Shouldn't reach here, but just in case
}

/**
 * Generate fallback tags based on keyword frequency when AI fails
 * @returns {string} - Comma-separated string of tags
 */
function generateFallbackTags(extractedText, metadata) {
  try {
    const text = `${metadata?.title || ''} ${metadata?.bajada || ''} ${extractedText}`.toLowerCase();
    
    // Split into words and remove stopwords
    const words = text.split(/\W+/).filter(word => 
      word.length > 3 && 
      !['para', 'como', 'esta', 'esto', 'estos', 'esta', 'estas', 'sobre', 'desde', 'entre', 'hasta', 'porque'].includes(word)
    );
    
    // Count word frequency
    const wordCount = {};
    words.forEach(word => {
      wordCount[word] = (wordCount[word] || 0) + 1;
    });
    
    // Sort by frequency
    const sortedWords = Object.entries(wordCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(entry => entry[0]);
    
    // Take top words and capitalize first letter
    const tags = sortedWords.slice(0, 6).map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    );
    
    // Add source as a tag if available
    if (metadata?.sourceName) {
      tags.push(metadata.sourceName);
    }
    
    // Join with commas
    const tagsString = tags.join(', ');
    
    console.log(`Generated fallback tags: ${tagsString}`);
    return tagsString;
  } catch (error) {
    console.error('Error in fallback tag generation:', error.message);
    return 'Noticias'; // Absolute minimum fallback
  }
}

/**
 * Generate social media text with hashtags and emojis
 * @param {string} extractedText - The raw text content
 * @param {object} metadata - The article metadata
 * @param {string} tags - The generated tags (comma-separated)
 * @returns {string} - Social media text with hashtags (< 500 chars)
 */
async function generateSocialMediaText(extractedText, metadata, tags, maxRetries = 3) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      // Add delay with exponential backoff
      const delayTime = API_DELAY * Math.pow(1.5, retries);
      console.log(`Waiting ${delayTime / 1000} seconds before generating social text...`);
      await delay(delayTime);

      const title = metadata?.title || '';
      const bajada = metadata?.bajada || '';
      
      const prompt = `
        Crea un texto atractivo para redes sociales de MENOS DE 500 CARACTERES (EXTREMADAMENTE IMPORTANTE) 
        que promocione este artículo. Incluye hashtags y emojis relevantes.

        TÍTULO: ${title}
        BAJADA: ${bajada}
        ETIQUETAS: ${tags}
        CONTENIDO: "${extractedText.substring(0, 2000)}"
        
        INSTRUCCIONES:
        1. El texto DEBE tener MENOS DE 500 CARACTERES en total (incluyendo hashtags y emojis).
        2. Escribe en español rioplatense con tono conversacional.
        3. Incluye 2-4 emojis estratégicamente ubicados para aumentar el impacto visual.
        4. Termina con 3-5 hashtags relevantes al contenido.
        5. Usa frases cortas y directas que generen interés.
        6. NO incluyas enlaces ni menciones (@).
        7. El contenido debe ser informativo pero intrigante para generar clics.
        8. CRUCIAL: Verifica que el texto final tenga MENOS DE 500 CARACTERES.
        
        Devuelve SOLO el texto para redes sociales, sin ningún comentario adicional.
      `;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      let socialText = response.text().trim();
      
      // Clean up any markdown or extra formatting
      socialText = socialText.replace(/^```[\s\S]*```$/gm, '').trim();
      
      // Enforce character limit
      if (socialText.length > 500) {
        socialText = socialText.substring(0, 497) + '...';
      }
      
      console.log(`Generated social media text: ${socialText.length} characters`);
      return socialText;
    } catch (error) {
      console.error(`Error generating social media text (attempt ${retries + 1}):`, error.message);
      retries++;
      
      if (retries >= maxRetries) {
        // Return basic fallback social media text
        console.warn('Using fallback social media text generation');
        return generateFallbackSocialText(metadata, tags);
      }
      
      await delay(2000); // Wait before retrying
    }
  }
  
  return generateFallbackSocialText(metadata, tags);
}

/**
 * Generate fallback social media text when AI fails
 */
function generateFallbackSocialText(metadata, tags) {
  try {
    const title = metadata?.title || 'Nuevo artículo';
    const bajada = metadata?.bajada || '';
    
    // Create emojis based on content
    let emojis = '📰';
    
    // Add topic-specific emojis
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.includes('econom') || lowerTitle.includes('dólar') || lowerTitle.includes('inflac')) {
      emojis += ' 💰';
    } else if (lowerTitle.includes('polít') || lowerTitle.includes('gobiern') || lowerTitle.includes('presiden')) {
      emojis += ' 🏛️';
    } else if (lowerTitle.includes('depor') || lowerTitle.includes('fútbol') || lowerTitle.includes('campeón')) {
      emojis += ' ⚽';
    } else if (lowerTitle.includes('salud') || lowerTitle.includes('hospital') || lowerTitle.includes('médic')) {
      emojis += ' 🏥';
    } else if (lowerTitle.includes('tecno') || lowerTitle.includes('digital') || lowerTitle.includes('intel')) {
      emojis += ' 💻';
    }
    
    // Generate hashtags from tags
    const tagsArray = tags.split(',').map(tag => tag.trim());
    const hashtags = tagsArray.slice(0, 4).map(tag => '#' + tag.replace(/\s+/g, '')).join(' ');
    
    // Create the text (ensure under 500 chars)
    let summary = bajada.length > 100 ? bajada.substring(0, 100) + '...' : bajada;
    if (!summary) {
      summary = 'Conoce todos los detalles en nuestro artículo.';
    }
    
    const socialText = `${emojis} ${title}\n\n${summary}\n\n${hashtags}`;
    
    // Ensure under 500 chars
    return socialText.length <= 500 ? socialText : socialText.substring(0, 497) + '...';
  } catch (error) {
    console.error('Error in fallback social text generation:', error.message);
    return '📰 Nuevo artículo disponible en nuestro portal. ¡No te lo pierdas! #Noticias';
  }
}