import * as configModule from './src/config/index.js'
import axios from 'axios'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { generateContent, printUsageReport } from './src/services/ai-service.js'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
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
  config.sections ? config.sections.length : 0,
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
  } items per section`,
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
  } section(s): ${sectionsToProcess.map((s) => s.name).join(', ')}`,
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
    'Make sure you have created all the necessary files in src/services',
  )
  process.exit(1)
}

// Configuration from config file
const GEMINI_API_KEY =
  config?.gemini?.apiKey || process.env.GEMINI_API_KEY || ''
console.log(
  'Using GEMINI_API_KEY:',
  GEMINI_API_KEY ? 'API key found' : 'No API key',
)
const GEMINI_MODEL =
  config?.gemini?.model || process.env.GEMINI_MODEL || 'gemini-2.0-flash'
const BATCH_SIZE = 1 // ✅ REDUCED from 2 to 1 - process ONE at a time
const FEED_SIZE = 50
const API_DELAY = 6000 // ✅ INCREASED from 3000 to 5000ms
const BATCH_DELAY = 20000 // ✅ INCREASED from 15000 to 20000ms
const SECTION_DELAY = 30000

// State directory to manage processing between runs
const STATE_DIR = path.join(__dirname, '.state')
if (!fs.existsSync(STATE_DIR)) {
  fs.mkdirSync(STATE_DIR)
}

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
      `Extracted ${extractedImages.length} captioned images from HTML content`,
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
 * Post-process text to fix formatting issues and normalize whitespace
 */
function postProcessText(text) {
  if (!text) return ''

  // ✅ STEP 1: Remove ALL inconsistent indentation and spacing
  let fixed = text
    // Remove any leading/trailing spaces on each line
    .split('\n')
    .map((line) => line.trim())
    .join('\n')

  // ✅ STEP 2: Normalize paragraph breaks (ensure double newlines between paragraphs)
  fixed = fixed
    .replace(/\n{3,}/g, '\n\n') // Replace 3+ newlines with 2
    .replace(/\n\s+\n/g, '\n\n') // Remove space-only lines

  // ✅ STEP 3: Fix lists that might have wrong spacing
  fixed = fixed.replace(/^\s*-\s+/gm, '- ')

  // ✅ STEP 4: Fix numbered lists
  fixed = fixed.replace(/^\s*(\d+)\.\s+/gm, '$1. ')

  // ✅ STEP 5: Fix headings that might have wrong spacing
  fixed = fixed.replace(/^#+\s+/gm, '## ')

  // ✅ STEP 6: Fix bolding that might be incorrect
  fixed = fixed.replace(/\*\*([^*]+)\*\*/g, '**$1**')

  // ✅ STEP 7: Remove any remaining markdown image syntax
  fixed = fixed.replace(/!\[[^\]]*\]\([^)]*\)/g, '')

  // ✅ STEP 8: Fix italic that might be incorrect
  fixed = fixed.replace(/\*([^*]+)\*/g, '*$1*')

  // ✅ STEP 9: Remove any tabs (replace with spaces)
  fixed = fixed.replace(/\t/g, ' ')

  // ✅ STEP 10: Remove excessive spaces within lines
  fixed = fixed.replace(/ {2,}/g, ' ')

  // ✅ STEP 11: Ensure text starts and ends cleanly
  fixed = fixed.trim()

  // ✅ STEP 12: Normalize quotes
  fixed = fixed.replace(/[""]/g, '"').replace(/['']/g, "'")

  return fixed
}

/**
 * Generate fallback metadata when AI is unavailable
 */
function generateFallbackMetadata(extractedText) {
  try {
    const paragraphs = extractedText
      .split(/\n+/)
      .filter((p) => p.trim().length > 30)

    const firstPara = paragraphs[0] || ''
    const secondPara = paragraphs[1] || ''
    const thirdPara = paragraphs[2] || ''

    const firstSentence = firstPara.split(/[.!?]/)[0] || ''
    const title = firstSentence.trim().substring(0, 80)

    let bajada = ''
    const meaningfulPara = [secondPara, thirdPara, firstPara].find(
      (p) =>
        p.length > 100 &&
        !p.match(/^(Se informó|Se anunció|Según|De acuerdo)/i),
    )

    if (meaningfulPara) {
      const sentences = meaningfulPara
        .split(/[.!?]+/)
        .filter((s) => s.trim().length > 20)
      bajada = sentences.slice(0, 2).join('. ').trim()

      const words = bajada.split(/\s+/)
      if (words.length > 50) {
        bajada = words.slice(0, 50).join(' ')
      } else if (words.length < 40 && sentences.length > 2) {
        bajada = sentences.slice(0, 3).join('. ').trim()
      }
    } else {
      bajada = firstPara
        .replace(/^(Se informó|Se anunció|Según|De acuerdo)[^.]*\.\s*/i, '')
        .trim()
    }

    if (bajada.length > 250) {
      bajada = bajada.substring(0, 247) + '...'
    }

    // ✅ NORMALIZE WHITESPACE IN METADATA
    const cleanTitle = title.trim().replace(/\s+/g, ' ')
    const cleanBajada = bajada.trim().replace(/\s+/g, ' ')

    let volanta = 'Actualidad'
    const lowerText = extractedText.toLowerCase()

    if (
      lowerText.match(
        /\b(fútbol|deport|equipo|jugador|campeón|partido|liga)\b/i,
      )
    ) {
      volanta = 'Deportes'
    } else if (
      lowerText.match(
        /\b(econom[íi]a|dólar|inflaci[oó]n|mercado|precio|peso)\b/i,
      )
    ) {
      volanta = 'Economía'
    } else if (
      lowerText.match(
        /\b(pol[íi]tic|gobierno|presiden|minister|ley|diputad)\b/i,
      )
    ) {
      volanta = 'Política'
    } else if (
      lowerText.match(/\b(cine|m[úu]sica|artista|show|festival|pel[íi]cula)\b/i)
    ) {
      volanta = 'Espectáculos'
    } else if (
      lowerText.match(/\b(tecnolog[íi]a|digital|internet|software|celular)\b/i)
    ) {
      volanta = 'Tecnología'
    } else if (
      lowerText.match(/\b(salud|hospital|m[ée]dic|tratamiento|paciente)\b/i)
    ) {
      volanta = 'Salud'
    } else if (
      lowerText.match(/\b(campo|agro|producci[oó]n|cosecha|ganado)\b/i)
    ) {
      volanta = 'Agro'
    } else if (
      lowerText.match(/\b(cultura|libro|arte|museo|exposici[oó]n)\b/i)
    ) {
      volanta = 'Cultura'
    }

    return {
      title: cleanTitle || 'Artículo sin título',
      bajada: cleanBajada || 'Contenido no disponible',
      volanta: volanta,
    }
  } catch (error) {
    console.error('Error in fallback metadata generation:', error.message)
    return {
      title: 'Artículo sin título',
      bajada: 'Resumen no disponible',
      volanta: 'Noticias',
    }
  }
}

/**
 * Convert text to sentence case (first letter uppercase, rest lowercase except proper nouns)
 */
function toSentenceCase(text) {
  if (!text) return ''

  const properNouns = [
    'Argentina',
    'Buenos Aires',
    'Coronel Suárez',
    'Huanguelén',
    'Facebook',
    'Instagram',
    'Twitter',
    'YouTube',
    'COVID',
    'AFA',
    'FIFA',
    'NBA',
    'ATP',
    'WTA',
  ]

  const words = text.trim().split(/\s+/)

  const result = words.map((word, index) => {
    const isProperNoun = properNouns.some(
      (noun) => word.toLowerCase() === noun.toLowerCase(),
    )

    if (isProperNoun) {
      return (
        properNouns.find((noun) => word.toLowerCase() === noun.toLowerCase()) ||
        word
      )
    }

    if (index === 0) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    }

    return word.toLowerCase()
  })

  return result.join(' ')
}

/**
 * Fallback metadata (NO source mentions) - IMPROVED
 */
function generateFallbackSocialMetadata(postText, sourceName, item) {
  const cleanText = postText
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
      '',
    )
    .replace(/[#@]/g, '')
    .trim()

  // Extract meaningful sentences
  const sentences = cleanText
    .split(/[.!?]+/)
    .filter((s) => s.trim().length > 20)

  // Create title from first meaningful sentence
  const title = sentences[0]?.substring(0, 80) || 'Actividad municipal'

  // Create bajada from subsequent sentences
  let bajada = ''
  if (sentences.length > 1) {
    bajada = sentences.slice(1, 3).join('. ').trim()
  } else {
    bajada = cleanText.substring(0, 200)
  }

  // Ensure bajada doesn't start with generic phrases
  bajada = bajada
    .replace(/^(Se informó|Se anunció|Según|De acuerdo)[^.]*\.\s*/i, '')
    .trim()

  // Determine volanta from content
  let volanta = 'Actividades'
  const lowerText = cleanText.toLowerCase()

  if (lowerText.match(/\b(evento|festival|show|espectáculo|presentación)\b/)) {
    volanta = 'Eventos locales'
  } else if (lowerText.match(/\b(taller|curso|capacitación|inscripción)\b/)) {
    volanta = 'Educación'
  } else if (lowerText.match(/\b(deporte|torneo|campeón|competencia)\b/)) {
    volanta = 'Deportes'
  } else if (lowerText.match(/\b(cultura|arte|museo|biblioteca)\b/)) {
    volanta = 'Cultura'
  }

  return {
    title: title,
    bajada: bajada.substring(0, 250),
    volanta: volanta,
  }
}

/**
 * Generates metadata for an article with retry logic and fallback
 */
async function generateMetadata(extractedText, maxRetries = 3) {
  try {
    const prompt = `Sos un editor de un medio de noticias argentino. Tu tarea es generar metadata periodística a partir del siguiente texto.

TEXTO A ANALIZAR:
"""
${extractedText.substring(0, 4000)}
"""

TAREA: Generar exactamente 3 campos en formato JSON.

CAMPO 1 - title (título):
- Máximo 80 caracteres
- Primera letra en mayúscula, resto en minúscula excepto nombres propios
- Sin signos de exclamación ni interrogación
- Sin comillas
- Debe capturar el hecho noticioso principal
- Ejemplo correcto: "El gobierno anunció nuevas medidas económicas para el sector agrario"
- Ejemplo incorrecto: "¡Increíbles Medidas Económicas Anunciadas Por El Gobierno!"

CAMPO 2 - bajada (copete/resumen):
- Exactamente entre 40 y 50 palabras (contar palabras, no caracteres)
- Debe ampliar la información del título sin repetirlo
- Incluir: quién, qué, cuándo, dónde si están disponibles
- Tono neutral e informativo
- Sin opiniones ni adjetivos valorativos
- Una sola oración o máximo dos oraciones

CAMPO 3 - volanta (cintillo superior):
- Máximo 4 palabras
- Indica el tema general o contexto
- Primera palabra en mayúscula, resto en minúscula
- No repetir palabras del título
- Ejemplos: "Economía nacional", "Crisis energética", "Elecciones 2024"

FORMATO DE RESPUESTA:
Responder ÚNICAMENTE con el JSON, sin explicaciones, sin bloques de código, sin texto adicional.

{"title": "texto del título aquí", "bajada": "texto de la bajada aquí con 40-50 palabras exactas", "volanta": "texto corto"}`

    const result = await generateContent(prompt, {
      maxRetries: 3,
      requireJson: false,
      preferGroq: false,
    })

    if (!result.text) {
      return generateFallbackMetadata(extractedText)
    }

    // Clean and extract JSON
    let cleanedText = result.text.trim()

    // Remove markdown code blocks if present
    cleanedText = cleanedText
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim()

    // Find the JSON object - look for opening brace to closing brace
    const startIndex = cleanedText.indexOf('{')
    const endIndex = cleanedText.lastIndexOf('}')

    if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
      console.warn('No valid JSON structure found in response')
      throw new Error('No valid JSON object found')
    }

    let jsonStr = cleanedText.substring(startIndex, endIndex + 1)

    // Clean up common JSON issues
    jsonStr = jsonStr
      .replace(/,\s*}/g, '}') // Remove trailing commas
      .replace(/\n/g, ' ') // Remove newlines inside JSON
      .replace(/\r/g, '') // Remove carriage returns
      .replace(/\t/g, ' ') // Replace tabs with spaces

    let parsed
    try {
      parsed = JSON.parse(jsonStr)
    } catch (parseError) {
      console.error('JSON parse error:', parseError.message)
      console.error('Raw text:', cleanedText.substring(0, 300))
      throw new Error('Invalid JSON format')
    }

    // Validate required fields
    if (!parsed.title || !parsed.bajada || !parsed.volanta) {
      console.warn('Missing required fields:', Object.keys(parsed))
      throw new Error('Incomplete metadata structure')
    }

    // Post-process: ensure title doesn't exceed 80 chars
    if (parsed.title.length > 80) {
      parsed.title = parsed.title.substring(0, 77) + '...'
    }

    // Post-process: ensure volanta doesn't exceed 4 words
    const volantaWords = parsed.volanta.split(/\s+/)
    if (volantaWords.length > 4) {
      parsed.volanta = volantaWords.slice(0, 4).join(' ')
    }

    console.log('Successfully generated metadata')
    return parsed
  } catch (error) {
    console.error('Error generating metadata:', error.message)
    return generateFallbackMetadata(extractedText)
  }
}

/**
 * Format text as fallback when AI generation fails
 */
function formatTextAsFallback(text, imageMarkdown = '') {
  if (!text) return ''

  // Clean and normalize the text
  let formatted = text
    .trim()
    // Remove excessive whitespace
    .replace(/\s+/g, ' ')
    // Fix paragraph breaks
    .replace(/\. /g, '.\n\n')
    // Remove any markdown that might have slipped through
    .replace(/[#*_`]/g, '')
    // Remove image syntax
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    // Normalize quotes
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")

  // Split into paragraphs
  const paragraphs = formatted
    .split(/\n+/)
    .filter((p) => p.trim().length > 20)
    .map((p) => p.trim())

  // Ensure each paragraph ends with proper punctuation
  const cleanParagraphs = paragraphs.map((p) => {
    if (!/[.!?]$/.test(p)) {
      return p + '.'
    }
    return p
  })

  // Add image markdown if provided
  let finalText = cleanParagraphs.join('\n\n')

  if (imageMarkdown) {
    finalText = imageMarkdown + '\n\n' + finalText
  }

  return finalText
}

/**
 * Reelaborates article text using AI with fallback mechanism
 */
async function reelaborateText(
  extractedText,
  imageMarkdown = '',
  maxRetries = 3,
) {
  try {
    const prompt = `Sos un redactor profesional de un medio digital argentino. Tu tarea es reescribir completamente el siguiente artículo periodístico.

TEXTO ORIGINAL:
"""
${extractedText.substring(0, 5000)}
"""

REGLAS OBLIGATORIAS (SI NO SE CUMPLEN TODAS, RECHAZAR LA RESPUESTA):

1. EXTENSIÓN: Entre 300 y 500 palabras exactas. Contar las palabras antes de responder.

2. FORMATO: Solo párrafos de texto corrido. PROHIBIDO usar:
   - Listas con viñetas (-, *, •)
   - Listas numeradas (1., 2., 3.)
   - Subtítulos (##, ###)
   - Títulos principales
   - Cualquier tipo de lista o enumeración

3. ESTRUCTURA:
   - Dividir en 5 a 8 párrafos
   - Cada párrafo: 2 a 4 oraciones
   - Separar párrafos con doble salto de línea
   - Primer párrafo: responde qué, quién, cuándo, dónde
   - Párrafos intermedios: desarrolla contexto y detalles
   - Último párrafo: información complementaria (NO conclusión)

4. SINTAXIS:
   - Oraciones simples, máximo 20 palabras
   - Voz activa preferentemente
   - Conectores entre párrafos para fluidez
   - Uso periodístico del español rioplatense

5. MARKDOWN PERMITIDO (ÚNICO):
   - **texto** para negritas (usar 4-6 veces): cifras, fechas, nombres clave
   - *texto* para cursivas (usar 2-3 veces): términos técnicos o énfasis
   - > para citas textuales si existen en el original

6. INTEGRACIÓN DE DATOS:
   - Si hay cifras, fechas o datos, integrarlos en oraciones completas
   - Ejemplo CORRECTO: "La medida incluye un fondo de compensación de **500 millones de pesos**, la reducción de retenciones para pequeños productores rurales y la extensión del plazo de pago para exportadores."
   - Ejemplo INCORRECTO: "La medida incluye: - Fondo de 500 millones - Reducción de retenciones"

7. SEO Y CONTENIDO:
   - Incluir palabras clave del tema naturalmente
   - Repetir términos importantes 2-3 veces
   - Primer párrafo debe captar atención
   - No agregar información externa al original
   - No incluir conclusiones tipo "en resumen" o "para finalizar"

8. TONO: Informativo, objetivo, sin opiniones ni valoraciones.

9. PROHIBICIONES ABSOLUTAS:
   - NO usar listas de ningún tipo
   - NO usar subtítulos
   - NO usar palabras: "puntos principales", "incluyen los siguientes", "a continuación", "destacan", "cabe mencionar"
   - NO usar emojis, hashtags, tablas
   - NO agregar frases de cierre o síntesis

EJEMPLO DE ESTRUCTURA CORRECTA (300-350 palabras):

El gobierno nacional presentó un nuevo paquete de medidas económicas que impactará directamente en el sector agropecuario argentino. El anuncio fue realizado por el ministro **Juan Pérez** durante una conferencia de prensa en Casa Rosada, donde detalló los alcances de la normativa que entrará en vigencia el **próximo 15 de marzo**.

La iniciativa contempla un fondo de compensación de **500 millones de pesos** destinado a pequeños y medianos productores rurales. Según explicó el funcionario, esta medida busca *estabilizar los precios internos* y proteger la capacidad productiva del sector. El fondo será administrado por el Ministerio de Agricultura en coordinación con las cámaras empresariales.

Entre los cambios más significativos se encuentra la reducción de retenciones para productores de hasta 100 hectáreas. Esta modificación representa un alivio fiscal de aproximadamente **30 por ciento** respecto a los valores actuales. Además, el gobierno extendió el plazo de pago para exportadores de granos, permitiendo mayor flexibilidad en las operaciones comerciales internacionales.

El paquete incluye también incentivos fiscales para empresas que inviertan en tecnología aplicada a la producción local. Las compañías que demuestren inversiones en maquinaria agrícola o sistemas de riego podrán acceder a deducciones impositivas durante los próximos **tres años fiscales**. Esta política apunta a modernizar el sector y mejorar la competitividad argentina en mercados externos.

Los representantes del sector agropecuario manifestaron su *postura cautelosa* respecto a las nuevas disposiciones. La Sociedad Rural Argentina solicitó una reunión técnica con autoridades del Ministerio de Economía para analizar el impacto específico en diferentes cadenas productivas. Organizaciones de pequeños productores expresaron satisfacción por la reducción de retenciones.

La normativa será publicada en el Boletín Oficial durante las próximas 48 horas. El gobierno estableció una mesa de diálogo permanente con el sector para evaluar los resultados de implementación y realizar ajustes necesarios según la evolución del contexto económico nacional.

RESPUESTA:
Devolver ÚNICAMENTE el texto reelaborado. Sin explicaciones. Sin comentarios. Sin bloques de código.`

    const result = await generateContent(prompt, {
      maxRetries: 3,
      preferGroq: false,
    })

    if (!result.text) {
      return formatTextAsFallback(extractedText, imageMarkdown)
    }

    let processedText = result.text
      .trim()
      .replace(/^```markdown\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()

    // VALIDATE: Check for bullet points or lists
    const hasBullets = /^[\s]*[-*•]\s/m.test(processedText)
    const hasNumberedList = /^[\s]*\d+\.\s/m.test(processedText)
    const hasSubtitles = /^#{1,6}\s+/m.test(processedText)

    if (hasBullets || hasNumberedList || hasSubtitles) {
      console.warn(
        '❌ Generated text contains lists or subtitles, using fallback...',
      )
      return formatTextAsFallback(extractedText, imageMarkdown)
    }

    // Count words
    const wordCount = processedText
      .split(/\s+/)
      .filter((w) => w.length > 0).length
    console.log(`✅ Generated text: ${wordCount} words`)

    if (wordCount < 250 || wordCount > 600) {
      console.warn(
        `⚠️ Word count out of range: ${wordCount} words, using fallback...`,
      )
      return formatTextAsFallback(extractedText, imageMarkdown)
    }

    // Clean up forbidden phrases
    processedText = processedText
      .replace(
        /\b(puntos principales|incluyen los siguientes|a continuación|destacan|cabe mencionar)\b/gi,
        '',
      )
      .replace(
        /\b(en resumen|en conclusión|para finalizar|para concluir)\b/gi,
        '',
      )
      .trim()

    return postProcessText(processedText)
  } catch (error) {
    console.error('Error reelaborating text:', error.message)
    return formatTextAsFallback(extractedText, imageMarkdown)
  }
}

/**
 * Reelaborates social media content into a professional news article
 */
async function reelaborateSocialMediaContent(postText, item, sourceName) {
  try {
    const prompt = `Sos un redactor profesional de un medio digital argentino. Tu tarea es transformar esta publicación corta de redes sociales en un artículo periodístico COMPLETO Y EXTENSO.

PUBLICACIÓN ORIGINAL (CORTA):
"""
${postText.substring(0, 3000)}
"""

CONTEXTO ADICIONAL:
- Autor/Fuente: ${item.authors?.[0]?.name || 'Institución local'}
- Fecha: ${item.date_published || 'Reciente'}

OBJETIVO CRÍTICO: Crear un artículo periodístico de 350-500 palabras a partir de esta publicación corta.

⚠️ IMPORTANTE: La publicación original es BREVE, pero vos tenés que EXPANDIRLA en un artículo COMPLETO.

CÓMO EXPANDIR EL CONTENIDO:

1. Si menciona un EVENTO:
   - Desarrollar en qué consiste
   - Explicar dónde y cuándo se realizará
   - Detallar horarios, requisitos, condiciones
   - Mencionar organizadores y participantes
   - Explicar el contexto o antecedentes
   - Describir el impacto esperado o la importancia

2. Si menciona una ACTIVIDAD/SERVICIO:
   - Explicar en detalle de qué se trata
   - Detallar cómo funciona, cómo acceder
   - Mencionar beneficiarios o público objetivo
   - Explicar requisitos o pasos a seguir
   - Contextualizar por qué es relevante
   - Agregar información sobre la institución organizadora

3. Si menciona un ANUNCIO/COMUNICADO:
   - Desarrollar qué implica exactamente
   - Explicar a quiénes afecta o beneficia
   - Detallar plazos, fechas, condiciones
   - Contextualizar la decisión o medida
   - Explicar antecedentes si corresponde
   - Mencionar próximos pasos

4. SIEMPRE AGREGAR:
   - Información sobre la institución/organismo que publica
   - Contexto local relevante
   - Datos concretos (fechas, horarios, lugares, números)
   - Información de contacto o consulta si está disponible

ESTRUCTURA OBLIGATORIA (4-6 PÁRRAFOS):

Párrafo 1: Presentar el hecho principal de forma periodística
Párrafo 2: Desarrollar detalles específicos (qué, cuándo, dónde, cómo)
Párrafo 3: Explicar contexto, antecedentes o relevancia
Párrafo 4: Agregar información complementaria (organizadores, requisitos, condiciones)
Párrafo 5 (opcional): Datos de contacto, inscripción o información adicional
Párrafo 6 (opcional): Impacto esperado o cierre informativo

REGLAS DE FORMATO:

- SOLO párrafos de texto corrido
- PROHIBIDO: listas (-, *, •), subtítulos, enumeraciones
- Usar **negritas** para fechas, horarios, nombres importantes (6-8 veces)
- Usar *cursivas* para énfasis (2-3 veces)
- Eliminar TODOS los emojis
- Eliminar hashtags y menciones
- NO mencionar "Facebook", "Instagram", "redes sociales"
- NO decir "según publicó", "compartió en", etc.

EXTENSIÓN: Entre 350 y 500 palabras. NO MENOS.

EJEMPLO DE EXPANSIÓN:

POST ORIGINAL (30 palabras):
"Este domingo 'Las dos horas del Cantorcito' en el teatro Samuel. 18hs. Entrada libre y gratuita! 🎵"

ARTÍCULO GENERADO (420 palabras):

El Municipio de Coronel Suárez anunció la realización del evento cultural "Las dos horas del Cantorcito" para este domingo en el teatro Samuel. La actividad musical forma parte de la programación mensual de espectáculos que organiza la Secretaría de Cultura municipal y contará con entrada libre y gratuita para todo el público.

El evento está programado para las **18 horas** con apertura de puertas desde las **17:30**. Los organizadores recomiendan llegar con anticipación dado que el teatro Samuel tiene capacidad para **300 espectadores** y se espera una concurrencia numerosa. Las puertas se abrirán por orden de llegada hasta completar el aforo disponible.

La propuesta incluye presentaciones de artistas locales y regionales que interpretarán un variado repertorio de música tradicional argentina. "Las dos horas del Cantorcito" es un formato que se viene desarrollando mensualmente en el teatro y ha logrado consolidarse como uno de los espectáculos más convocantes de la agenda cultural local. En ediciones anteriores, el evento reunió a más de *250 personas* y recibió elogios tanto del público como de los artistas participantes.

El teatro Samuel se encuentra ubicado en **calle Rivadavia 250** del centro de Coronel Suárez. El edificio cuenta con accesibilidad para personas con movilidad reducida y dispone de estacionamiento en las inmediaciones. Las autoridades municipales destacaron que el espacio cumple con todos los protocolos de seguridad vigentes y dispone de las habilitaciones correspondientes.

Para aquellos interesados en asegurar su lugar, el municipio habilitó un sistema de reserva anticipada. Las entradas pueden retirarse a partir del **viernes 7 de febrero** en la boletería del teatro, en horario de **9 a 13 horas**. También está disponible la opción de reserva telefónica comunicándose al número **02926-420100** en el mismo horario. Cada persona podrá retirar hasta dos entradas por presentación de DNI.

La Secretaría de Cultura informó que este evento forma parte de una serie de actividades culturales gratuitas que se desarrollarán durante todo el mes. El objetivo es acercar propuestas artísticas de calidad a la comunidad y promover el acceso a la cultura en todas sus expresiones. Próximamente se darán a conocer las fechas de nuevas presentaciones.

RESPUESTA:
Devolver ÚNICAMENTE el artículo expandido. Sin explicaciones.`

    const result = await generateContent(prompt, {
      maxRetries: 3,
      preferGroq: false,
    })

    if (!result.text) {
      return formatSocialMediaAsFallback(postText, sourceName, item)
    }

    let processedText = result.text
      .trim()
      .replace(/^```markdown\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()

    // VALIDATE: Remove any emojis that slipped through
    processedText = processedText.replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1FA70}-\u{1FAFF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}]/gu,
      '',
    )

    // VALIDATE: Remove references to social media
    processedText = processedText.replace(
      /\b(según publicó|compartió en|posteó en|difundió en|anunció en|publicó en)\s+(Facebook|Instagram|Twitter|YouTube|redes sociales|la plataforma|su cuenta)\b/gi,
      '',
    )

    const hasBullets = /^[\s]*[-*•]\s/m.test(processedText)
    const hasNumberedList = /^[\s]*\d+\.\s/m.test(processedText)
    const hasSubtitles = /^#{1,6}\s+/m.test(processedText)

    if (hasBullets || hasNumberedList || hasSubtitles) {
      console.warn(
        '❌ Social media text contains lists/subtitles, using fallback...',
      )
      return formatSocialMediaAsFallback(postText, sourceName, item)
    }

    const wordCount = processedText
      .split(/\s+/)
      .filter((w) => w.length > 0).length
    console.log(`✅ Generated social media article: ${wordCount} words`)

    // ✅ ADJUSTED VALIDATION: Lower minimum for social media (250 words instead of 300)
    if (wordCount < 250) {
      console.warn(
        `⚠️ Social media article too short: ${wordCount} words, using fallback...`,
      )
      return formatSocialMediaAsFallback(postText, sourceName, item)
    }

    if (wordCount > 600) {
      console.warn(
        `⚠️ Social media article too long: ${wordCount} words, trimming...`,
      )
      // Trim to approximately 500 words
      const words = processedText.split(/\s+/)
      processedText = words.slice(0, 500).join(' ')
    }

    return postProcessText(processedText)
  } catch (error) {
    console.error('Error reelaborating social media:', error.message)
    return formatSocialMediaAsFallback(postText, sourceName, item)
  }
}

/**
 * Fallback for social media content - IMPROVED to generate longer articles
 */
function formatSocialMediaAsFallback(postText, sourceName, item) {
  try {
    // AGGRESSIVE emoji and special char removal
    let cleanText = postText
      .replace(
        /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1FA70}-\u{1FAFF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}]/gu,
        '',
      )
      .replace(/[#@]/g, '')
      .replace(/https?:\/\/[^\s]+/g, '')
      .replace(/[\uFE00-\uFE0F]/g, '')
      .replace(/[\u200D]/g, '')
      .trim()

    const author = item.authors?.[0]?.name || 'la institución local'
    const date = item.date_published
      ? new Date(item.date_published).toLocaleDateString('es-AR', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : 'próximamente'

    let article = ''
    const sentences = cleanText
      .split(/[.!?]+/)
      .filter((s) => s.trim().length > 10)

    if (sentences.length === 0) {
      // Generic fallback when no content
      return `Se informó sobre una nueva actividad programada por ${author}. La convocatoria está dirigida al público en general y se realizará durante ${date}. Los interesados podrán obtener más información a través de los canales oficiales de comunicación. La actividad forma parte de las iniciativas que se desarrollan regularmente en la comunidad. Se espera una importante participación del público local. Los organizadores destacaron la relevancia de la propuesta para la comunidad.`
    }

    // ✅ IMPROVED: Create a more substantial article from limited content

    // Paragraph 1: Main announcement
    article += `Se anunció la realización de una nueva actividad organizada por ${author}. `
    article += `${sentences[0].trim()}. `
    if (sentences.length > 1) {
      article += `${sentences[1].trim()}.\n\n`
    } else {
      article += `La información fue confirmada durante la jornada del ${date}.\n\n`
    }

    // Paragraph 2: Details and context
    article += `La convocatoria está dirigida al público en general e incluye detalles específicos sobre la actividad programada. `
    if (sentences.length > 2) {
      article += `${sentences[2].trim()}. `
    }
    article += `Los organizadores destacaron la importancia de esta iniciativa para la comunidad local. `
    article += `La propuesta forma parte de las actividades regulares que se desarrollan en el ámbito municipal.\n\n`

    // Paragraph 3: Additional information
    if (sentences.length > 3) {
      article += `${sentences[3].trim()}. `
    }
    article += `Las autoridades informaron que se esperan detalles adicionales en los próximos días. `
    article += `La actividad cuenta con el apoyo de distintas áreas del municipio y organizaciones locales. `
    if (sentences.length > 4) {
      article += `${sentences[4].trim()}.\n\n`
    } else {
      article += `Los interesados pueden consultar por más información a través de los canales oficiales.\n\n`
    }

    // Paragraph 4: Participation and access
    article += `El acceso a la actividad estará disponible para todos los vecinos de la localidad. `
    article += `Se recomienda consultar los horarios y requisitos específicos con anticipación. `
    article += `Los organizadores indicaron que se brindarán facilidades para garantizar la participación del mayor número posible de personas.\n\n`

    // Paragraph 5: Context and importance
    article += `Este tipo de iniciativas buscan promover la participación ciudadana y fortalecer los vínculos comunitarios. `
    article += `Las autoridades destacaron el compromiso con la realización de actividades que beneficien a la población. `
    article += `La información completa está disponible para consultas del público interesado en los canales oficiales de comunicación.`

    // Final emoji cleanup
    article = article.replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1FA70}-\u{1FAFF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}]/gu,
      '',
    )

    return article
  } catch (error) {
    console.error('Error in social media fallback formatting:', error.message)
    return `Se informó sobre una actividad programada por la institución local. Los detalles fueron dados a conocer durante la jornada. La convocatoria está dirigida al público en general. Los interesados pueden consultar por más información a través de los canales oficiales. La actividad forma parte de las iniciativas regulares que se desarrollan en la comunidad. Se espera una importante participación del público. Los organizadores destacaron la relevancia de la propuesta.`
  }
}

/**
 * Generate metadata for social media (NO source mentions)
 */
async function generateSocialMediaMetadata(postText, sourceName, item) {
  try {
    const prompt = `Genera metadata periodística para esta publicación.

POST:
"""
${postText.substring(0, 2000)}
"""

Generar JSON con 3 campos:

1. title: Título periodístico (max 80 chars)
   - **SENTENCE CASE**: Solo primera letra en mayúscula, resto en minúscula (excepto nombres propios)
   - Ejemplo correcto: "El municipio anunció nuevas actividades culturales"
   - Ejemplo INCORRECTO: "El Municipio Anunció Nuevas Actividades Culturales"
   - NO mencionar red social
   - NO usar emojis ni hashtags
   - Convertir el post en título formal

2. bajada: Resumen 40-50 palabras
   - Tono formal periodístico
   - NO mencionar "según publicó en Facebook/Instagram/Twitter"
   - NO usar emojis

3. volanta: Categoría (max 4 palabras)
   - **SENTENCE CASE**: Solo primera letra en mayúscula
   - Ejemplos: "Cultura y espectáculos", "Actividades municipales", "Convocatorias"

PROHIBIDO mencionar: Facebook, Instagram, Twitter, YouTube, redes sociales

Responder SOLO con JSON:
{"title": "...", "bajada": "...", "volanta": "..."}`

    const result = await generateContent(prompt, {
      maxRetries: 3,
      requireJson: false,
      preferGroq: false,
    })

    if (!result.text) {
      return generateFallbackSocialMetadata(postText, sourceName, item)
    }

    let cleanedText = result.text
      .trim()
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim()

    const startIndex = cleanedText.indexOf('{')
    const endIndex = cleanedText.lastIndexOf('}')

    if (startIndex === -1 || endIndex === -1) {
      throw new Error('No valid JSON found')
    }

    let jsonStr = cleanedText
      .substring(startIndex, endIndex + 1)
      .replace(/,\s*}/g, '}')
      .replace(/\n/g, ' ')
      .replace(/\r/g, '')
      .replace(/\t/g, ' ')

    const parsed = JSON.parse(jsonStr)

    if (!parsed.title || !parsed.bajada || !parsed.volanta) {
      throw new Error('Missing required fields')
    }

    // ✅ FORCE SENTENCE CASE - Remove all emojis and fix capitalization
    parsed.title = toSentenceCase(
      parsed.title
        .replace(
          /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
          '',
        )
        .trim(),
    )

    parsed.bajada = parsed.bajada
      .replace(
        /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
        '',
      )
      .trim()

    parsed.volanta = toSentenceCase(
      parsed.volanta
        .replace(
          /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
          '',
        )
        .trim(),
    )

    if (parsed.title.length > 80) {
      parsed.title = parsed.title.substring(0, 77) + '...'
    }

    const volantaWords = parsed.volanta.split(/\s+/)
    if (volantaWords.length > 4) {
      parsed.volanta = volantaWords.slice(0, 4).join(' ')
    }

    console.log('Successfully generated social media metadata')
    return parsed
  } catch (error) {
    console.error('Error generating social media metadata:', error.message)
    return generateFallbackSocialMetadata(postText, sourceName, item)
  }
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
    /*     console.log(`Generating social media text for: ${item.url}`)
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
    } */

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
      mundo: 'Mundo', // ✅ ADD THIS
      espectaculos: 'Espectáculos', // ✅ ADD THIS
      ambiente: 'Ambiente',
      clima: 'Clima',
      tecnologia: 'Tecnología',
      actualidad: 'Actualidad',
      'cine-series': 'Cine y Series',
      'historia-literatura': 'Historia y Literatura',
    }

    // Replace the hardcoded section mapping with this more dynamic lookup
    // Default to empty string as requested
    let sectionValue = sectionIdToAirtableValue[sectionId] || ''

    // Look up the section in our mapping
    if (sectionIdToAirtableValue[sectionId]) {
      sectionValue = sectionIdToAirtableValue[sectionId]
    }

    // Extract source name from the URL
    const sourceName = extractSourceName(item.url)
    console.log(`Extracted source name: ${sourceName} from URL: ${item.url}`)

    // Find the recordFields creation around line 1036 and modify it:

    const recordFields = {
      title: metadata ? metadata.title : item.title,
      overline: metadata ? metadata.volanta : 'No overline available.',
      excerpt: metadata ? metadata.bajada : 'No summary available.',
      article: processedText,
      image: imageAttachments, // ✅ Array of attachment objects for Airtable

      author: '',
      // ✅ MODIFIED: Set placeholder values that will be updated with Airtable URLs
      imgUrl: '', // Will be populated with Airtable URL after insertion
      'article-images': '', // Will be populated with Airtable URLs after insertion

      url: item.url,
      source: sourceName,
      'ig-post': instagramContent || '',
      'fb-post': facebookContent || '',
      'tw-post': twitterContent || '',
      'yt-video': youtubeContent || '',
      section: sectionValue,
      status: 'draft',
      tags: tags,
      /* socialMediaText: socialMediaText, */
      front: '',
      order: '',
    }

    console.log(
      `Successfully processed article: ${item.url} for section ${sectionId}`,
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
    `Processing batch of ${items.length} items for section ${sectionId}`,
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
      `Waiting ${API_DELAY / 1000} seconds before processing next article...`,
    )
    await delay(API_DELAY)
  }

  console.log(
    `Successfully processed ${results.length} out of ${items.length} items for section ${sectionId}`,
  )
  return results
}

/**
 * Processes a section
 */
async function processSection(section) {
  console.log(`\n=== Processing section: ${section.name} ===\n`)

  // Special handling for Instituciones social media content
  if (
    section.id === 'instituciones' ||
    section.id === 'local-facebook' ||
    section.id === 'huanguelen' ||
    section.id === 'pueblos-alemanes'
  ) {
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
        `Fetched ${feedData.items.length} items from ${section.name} feed`,
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
          }`,
        )
        return
      }

      console.log(
        `Found ${newItems.length} ${
          args.force ? '' : 'new '
        }items to process for ${section.name}`,
      )

      // Apply the limit
      const limitedItems = newItems.slice(0, ITEM_LIMIT)
      console.log(
        `Processing ${limitedItems.length} social media items (limit: ${ITEM_LIMIT})`,
      )

      // Process the limited items
      for (const item of limitedItems) {
        try {
          const itemUrl = item.url || ''
          console.log(
            `Processing social media item: ${
              item.title || 'Untitled'
            } (${itemUrl})`,
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
              `Error parsing URL: ${e.message}. Using default source name.`,
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

          // Reelaborate social media content into article
          console.log(`Reelaborating social media content for: ${itemUrl}`)
          let reelaboratedArticle = null
          try {
            reelaboratedArticle = await reelaborateSocialMediaContent(
              postText,
              item,
              sourceName,
            )
          } catch (textError) {
            console.error(
              `Error reelaborating social media text: ${textError.message}`,
            )
            reelaboratedArticle = formatSocialMediaAsFallback(
              postText,
              sourceName,
              item,
            )
          }

          // Generate metadata for social media content
          console.log(
            `Generating metadata for social media content: ${itemUrl}`,
          )
          let metadata = null
          try {
            metadata = await generateSocialMediaMetadata(
              postText,
              sourceName,
              item,
            )
          } catch (metaError) {
            console.error(
              `Error generating social media metadata: ${metaError.message}`,
            )
            metadata = generateFallbackSocialMetadata(
              postText,
              sourceName,
              item,
            )
          }

          // Create record fields using the generated metadata
          const recordFields = {
            title: metadata.title,
            url: itemUrl,
            excerpt: metadata.bajada,
            source: sourceName,
            imgUrl: imageUrl || '',
            article: reelaboratedArticle,
            overline: metadata.volanta,
            author: item.authors?.[0]?.name || '',
            status: 'draft',
            processingStatus: 'completed',
            postDate: item.date_published || '',
            postDateFormatted: pubDate,
            image: imageUrl ? [{ url: imageUrl }] : [],
          }

          // ✅ ADD TAG GENERATION FOR SOCIAL MEDIA
          try {
            console.log(`Generating tags for social media item: ${itemUrl}`)
            const socialText = `${metadata.title} ${metadata.bajada} ${reelaboratedArticle}`
            const tags = await generateTags(socialText, metadata)
            console.log(`Generated tags: ${tags}`)
            recordFields.tags = tags
          } catch (genError) {
            console.error(`Error generating tags: ${genError.message}`)
            recordFields.tags = generateFallbackTags(
              reelaboratedArticle,
              metadata,
            )
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
              section.id,
            )
            console.log(
              `Added social media item to Airtable: ${recordFields.title}`,
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
              `Error adding item to Airtable: ${airtableError.message}`,
            )
          }

          // Add a delay to avoid rate limits
          await delay(API_DELAY)
        } catch (itemError) {
          console.error(
            `Error processing social media item: ${itemError.message}`,
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
      `Fetched ${feedData.items.length} items from ${section.name} feed`,
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
        }`,
      )
      return
    }

    console.log(
      `Found ${newItems.length} ${
        args.force ? '' : 'new '
      }items to process for ${section.name}`,
    )

    // Apply the limit
    const limitedItems = newItems.slice(0, ITEM_LIMIT)
    console.log(
      `Processing ${limitedItems.length} items (limit: ${ITEM_LIMIT})`,
    )

    // Process the limited items instead of all items
    for (let i = 0; i < limitedItems.length; i += BATCH_SIZE) {
      const batchItems = limitedItems.slice(i, i + BATCH_SIZE)
      console.log(
        `\n=== Processing batch ${
          Math.floor(i / BATCH_SIZE) + 1
        } of ${Math.ceil(limitedItems.length / BATCH_SIZE)} for ${
          section.name
        } ===\n`,
      )

      const processedBatch = await processBatch(batchItems, section.id)

      if (processedBatch.length > 0) {
        // Insert into Airtable with section ID
        try {
          await airtableService.insertRecords(processedBatch, section.id)
          console.log(
            `Inserted ${processedBatch.length} records into ${section.name} Airtable table`,
          )
        } catch (error) {
          console.error(
            `Error inserting records into ${section.name} Airtable:`,
            error.message,
          )
        }
      }

      // Add a longer delay between batches
      if (i + BATCH_SIZE < limitedItems.length) {
        console.log(
          `Waiting ${
            BATCH_DELAY / 1000
          } seconds before processing next batch...`,
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
      (a, b) => a.priority - b.priority,
    )

    // Process each section sequentially
    for (const section of sortedSections) {
      await processSection(section)

      // Add a longer delay between sections
      if (section !== sortedSections[sortedSections.length - 1]) {
        console.log(
          `\nWaiting ${
            SECTION_DELAY / 1000
          } seconds before processing next section...\n`,
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
    `Fetched ${items.length} items, returning ${limitedItems.length} (limit: ${ITEM_LIMIT})`,
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
    ITEM_LIMIT === Infinity ? 'No limit' : ITEM_LIMIT,
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
    ITEM_LIMIT === Infinity ? 'No limit' : ITEM_LIMIT,
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
      '',
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
  try {
    const title = metadata?.title || ''
    const bajada = metadata?.bajada || ''

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
      
      IMPORTANTE: Devuelve SOLO un array JSON sin ningún texto adicional.
      NO incluyas explicaciones, comentarios, ni bloques de código markdown.
      
      Formato requerido:
      ["etiqueta1", "etiqueta2", "etiqueta3", "etiqueta4", "etiqueta5"]
    `

    // ✅ USE NEW AI SERVICE - Groq is good for simple tasks
    const result = await generateContent(prompt, {
      maxRetries: 3,
      requireJson: false, // Don't validate yet
      preferGroq: true, // ✅ Groq is faster for simple tasks
    })

    if (!result.text) {
      return generateFallbackTags(extractedText, metadata)
    }

    // ✅ IMPROVED JSON EXTRACTION
    let cleanedText = result.text.trim()

    // Remove markdown code blocks
    cleanedText = cleanedText
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim()

    // Try to find JSON array using regex
    const jsonMatch = cleanedText.match(/\[[\s\S]*?\]/)

    if (!jsonMatch) {
      console.warn(
        'No JSON array found in response:',
        cleanedText.substring(0, 200),
      )
      throw new Error('No valid JSON array found')
    }

    const jsonStr = jsonMatch[0]

    // Try to parse
    let tags
    try {
      tags = JSON.parse(jsonStr)
    } catch (parseError) {
      console.error('JSON parse error:', parseError.message)
      console.error('Attempted to parse:', jsonStr.substring(0, 200))
      throw new Error('Invalid JSON format')
    }

    if (!Array.isArray(tags) || tags.length === 0) {
      throw new Error('Invalid tags format or empty array')
    }

    const formattedTags = tags.map((tag) =>
      tag
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' '),
    )

    const tagsString = formattedTags.join(', ')
    console.log(`Generated tags: ${tagsString}`)
    return tagsString
  } catch (error) {
    console.error('Error generating tags:', error.message)
    return generateFallbackTags(extractedText, metadata)
  }
}
/**
 * Generate fallback tags based on keyword frequency when AI fails
 * @returns {string} - Comma-separated string of tags
 */
function generateFallbackTags(extractedText, metadata) {
  try {
    const text = `${metadata?.title || ''} ${
      metadata?.bajada || ''
    } ${extractedText}`.toLowerCase()

    // Split into words and remove stopwords
    const words = text
      .split(/\W+/)
      .filter(
        (word) =>
          word.length > 3 &&
          ![
            'para',
            'como',
            'esta',
            'esto',
            'estos',
            'esta',
            'estas',
            'sobre',
            'desde',
            'entre',
            'hasta',
            'porque',
          ].includes(word),
      )

    // Count word frequency
    const wordCount = {}
    words.forEach((word) => {
      wordCount[word] = (wordCount[word] || 0) + 1
    })

    // Sort by frequency
    const sortedWords = Object.entries(wordCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map((entry) => entry[0])

    // Take top words and capitalize first letter
    const tags = sortedWords
      .slice(0, 6)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))

    // Add source as a tag if available
    if (metadata?.sourceName) {
      tags.push(metadata.sourceName)
    }

    // Join with commas
    const tagsString = tags.join(', ')

    console.log(`Generated fallback tags: ${tagsString}`)
    return tagsString
  } catch (error) {
    console.error('Error in fallback tag generation:', error.message)
    return 'Noticias' // Absolute minimum fallback
  }
}

/**
 * Generate social media text with hashtags and emojis
 * @param {string} extractedText - The raw text content
 * @param {object} metadata - The article metadata
 * @param {string} tags - The generated tags (comma-separated)
 * @returns {string} - Social media text with hashtags (< 500 chars)
 */
/**
 * Generate social media text with hashtags and emojis
 * @param {string} extractedText - The raw text content
 * @param {object} metadata - The article metadata
 * @param {string} tags - The generated tags (comma-separated)
 * @returns {string} - Social media text with hashtags (< 500 chars)
 */

/**
 * Generate fallback social media text when AI fails
 */
function generateFallbackSocialText(metadata, tags) {
  try {
    const title = metadata?.title || 'Nuevo artículo'
    const bajada = metadata?.bajada || ''

    // Create emojis based on content
    let emojis = '📰'

    // Add topic-specific emojis
    const lowerTitle = title.toLowerCase()
    if (
      lowerTitle.includes('econom') ||
      lowerTitle.includes('dólar') ||
      lowerTitle.includes('inflac')
    ) {
      emojis += ' 💰'
    } else if (
      lowerTitle.includes('polít') ||
      lowerTitle.includes('gobierno') ||
      lowerTitle.includes('presiden')
    ) {
      emojis += ' 🏛️'
    } else if (
      lowerTitle.includes('depor') ||
      lowerTitle.includes('fútbol') ||
      lowerTitle.includes('campeón')
    ) {
      emojis += ' ⚽'
    } else if (
      lowerTitle.includes('salud') ||
      lowerTitle.includes('hospital') ||
      lowerTitle.includes('médic')
    ) {
      emojis += ' 🏥'
    } else if (
      lowerTitle.includes('tecno') ||
      lowerTitle.includes('digital') ||
      lowerTitle.includes('intel')
    ) {
      emojis += ' 💻'
    }

    // Generate hashtags from tags
    const tagsArray = tags.split(',').map((tag) => tag.trim())
    const hashtags = tagsArray
      .slice(0, 4)
      .map((tag) => '#' + tag.replace(/\s+/g, ''))
      .join(' ')

    // Create the text (ensure under 500 chars)
    let summary =
      bajada.length > 100 ? bajada.substring(0, 100) + '...' : bajada
    if (!summary) {
      summary = 'Conoce todos los detalles en nuestro artículo.'
    }

    const socialText = `${emojis} ${title}\n\n${summary}\n\n${hashtags}`

    // Ensure under 500 chars
    return socialText.length <= 500
      ? socialText
      : socialText.substring(0, 497) + '...'
  } catch (error) {
    console.error('Error in fallback social text generation:', error.message)
    return '📰 Nuevo artículo disponible en nuestro portal. ¡No te lo pierdas! #Noticias'
  }
}

// ✅ AT THE END OF THE SCRIPT, ADD USAGE REPORT
processAllRequestedSections()
  .then(() => {
    console.log('Process completed')
    printUsageReport() // Show AI usage statistics
  })
  .catch((error) => console.error('Process failed:', error.message))
