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
import * as prompts from './src/prompts/index.js'
import * as scraper from './src/services/scraper.js'

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
 * Delegates to the improved scraper module.
 */
function extractImagesAsMarkdown(htmlContent) {
  return scraper.extractImagesAsMarkdown(htmlContent)
}

/**
 * Fetches HTML content from a URL with retries and better headers.
 * Delegates to the improved scraper module.
 */
async function fetchContent(url, timeout = 15000) {
  return scraper.fetchContent(url, { timeout, maxRetries: 2 })
}

/**
 * Extracts main text content from HTML using multi-strategy pipeline.
 * Delegates to the improved scraper module.
 */
function extractText(htmlContent) {
  const result = scraper.extractText(htmlContent)
  return result.text || ''
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

    // No truncation — send complete bajada

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
    const prompt = prompts.generateMetadata(extractedText)

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

    // Post-process: strip any markdown from plain-text fields
    const stripMarkdown = (str) =>
      str
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^#+\s*/gm, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/ {2,}/g, ' ')
        .trim()

    parsed.title = stripMarkdown(parsed.title)
    parsed.bajada = stripMarkdown(parsed.bajada)
    parsed.volanta = stripMarkdown(parsed.volanta)

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
    const prompt = prompts.reelaborateArticle(extractedText)

    const result = await generateContent(prompt, {
      maxTokens: 8192,
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

    // Count words
    const wordCount = processedText
      .split(/\s+/)
      .filter((w) => w.length > 0).length
    console.log(`✅ Generated text: ${wordCount} words`)

    if (wordCount < 80) {
      console.warn(
        `⚠️ Generated text too short (${wordCount} words), using fallback...`,
      )
      return formatTextAsFallback(extractedText, imageMarkdown)
    }

    // Clean up filler phrases
    processedText = processedText
      .replace(
        /\b(puntos principales|incluyen los siguientes|a continuación|destacan|cabe mencionar|cabe destacar|es importante mencionar|vale la pena señalar|en este contexto|por su parte|en ese sentido)\b/gi,
        '',
      )
      .replace(
        /\b(en resumen|en conclusión|para finalizar|para concluir|de esta manera)\b/gi,
        '',
      )
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .replace(/ {2,}/g, ' ')
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
    const prompt = prompts.reelaborateSocialMedia(postText, item, sourceName)

    const result = await generateContent(prompt, {
      maxTokens: 8192,
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

    const wordCount = processedText
      .split(/\s+/)
      .filter((w) => w.length > 0).length
    console.log(`✅ Generated social media article: ${wordCount} words`)

    if (wordCount < 80) {
      console.warn(
        `⚠️ Social media article too short (${wordCount} words), using fallback...`,
      )
      return formatSocialMediaAsFallback(postText, sourceName, item)
    }

    if (wordCount > 600) {
      console.warn(
        `⚠️ Social media article too long: ${wordCount} words, trimming...`,
      )
      const words = processedText.split(/\s+/)
      processedText = words.slice(0, 500).join(' ')
    }

    // Clean up filler phrases
    processedText = processedText
      .replace(
        /\b(cabe destacar|es importante mencionar|vale la pena señalar|en este contexto|por su parte|en ese sentido)\b/gi,
        '',
      )
      .replace(
        /\b(en resumen|en conclusión|para finalizar|para concluir|de esta manera)\b/gi,
        '',
      )
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .replace(/ {2,}/g, ' ')
      .trim()

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
    const prompt = prompts.generateSocialMediaMetadata(postText)

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

    const volantaWords = parsed.volanta.split(/\s+/)
    if (volantaWords.length > 4) {
      parsed.volanta = volantaWords.slice(0, 4).join(' ')
    }

    // Strip any markdown from plain-text fields
    const stripMd = (str) =>
      str
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^#+\s*/gm, '')
        .replace(/ {2,}/g, ' ')
        .trim()
    parsed.title = stripMd(parsed.title)
    parsed.bajada = stripMd(parsed.bajada)
    parsed.volanta = stripMd(parsed.volanta)
    return parsed
  } catch (error) {
    console.error('Error generating social media metadata:', error.message)
    return generateFallbackSocialMetadata(postText, sourceName, item)
  }
}

/**
 * Detect if a URL is from a social media platform
 */
function isSocialMediaUrl(url) {
  try {
    const hostname = new URL(url).hostname
    return (
      hostname.includes('facebook.com') ||
      hostname.includes('instagram.com') ||
      hostname.includes('twitter.com') ||
      hostname.includes('x.com') ||
      hostname.includes('youtube.com') ||
      hostname.includes('youtu.be')
    )
  } catch {
    return false
  }
}

/**
 * Detect social media type from URL for the corresponding Airtable field
 */
function getSocialMediaType(url) {
  try {
    const hostname = new URL(url).hostname
    if (hostname.includes('facebook.com')) return 'fb-post'
    if (hostname.includes('instagram.com')) return 'ig-post'
    if (hostname.includes('twitter.com') || hostname.includes('x.com'))
      return 'tw-post'
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be'))
      return 'yt-video'
  } catch {}
  return ''
}

// Create a dynamic mapping of section IDs to Airtable values (module-level, shared)
const sectionIdToAirtableValue = {
  'coronel-suarez': 'Coronel Suárez',
  'pueblos-alemanes': 'Pueblos Alemanes',
  huanguelen: 'Huanguelén',
  'la-sexta': 'La Sexta',
  instituciones: 'Instituciones',
  'local-facebook': 'Local Facebook',
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
  mundo: 'Mundo',
  espectaculos: 'Espectáculos',
  ambiente: 'Ambiente',
  clima: 'Clima',
  tecnologia: 'Tecnología',
  actualidad: 'Actualidad',
  'cine-series': 'Cine y Series',
  'historia-literatura': 'Historia y Literatura',
  recetas: 'Recetas',
  'primera-plana': 'Primera Plana',
  local: 'Local',
  'deporte-local-regional': 'Deporte Local y Regional',
  quiniela: 'Quiniela',
  autos: 'Autos',
}

/**
 * Processes a single article — unified pipeline for all sections.
 * Auto-detects social media sources and uses the appropriate prompt.
 */
async function processArticle(item, sectionId) {
  try {
    const itemUrl = item.url || ''
    console.log(`Processing article: ${itemUrl} for section ${sectionId}`)

    const isSocial = isSocialMediaUrl(itemUrl)
    const socialMediaType = isSocial ? getSocialMediaType(itemUrl) : ''

    // ── STEP 1: Extract content ──────────────────────────────────────────
    let extractedText = ''
    let htmlContent = ''
    let sourceName = ''

    if (isSocial) {
      // Social media: content comes from the RSS feed fields
      let postText = item.content_text || ''
      if ((!postText || postText.length < 100) && item.content_html) {
        const htmlText = scraper.extractFromContentHtml(item.content_html)
        if (htmlText && htmlText.length > postText.length) {
          console.log(
            `📝 Using content_html (${htmlText.length} chars) over content_text (${postText.length} chars)`,
          )
          postText = htmlText
        }
      }
      if (!postText || postText.length < 50) {
        postText = item.summary || item.title || postText
      }
      extractedText = postText
      htmlContent = item.content_html || ''

      // Determine source name from URL hostname
      try {
        const hostname = new URL(itemUrl).hostname
        const domain = hostname.replace(/^www\./, '')
        const parts = domain.split('.')
        sourceName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
      } catch {
        sourceName = item.authors?.[0]?.name || 'Social Media'
      }
    } else {
      // Regular article: scrape the URL with RSS fallback
      const scrapeResult = await scraper.scrapeArticle(itemUrl, {
        timeout: 15000,
        rssContentText: item.content_text || '',
        rssContentHtml: item.content_html || '',
        rssTitle: item.title || '',
      })
      extractedText = scrapeResult.text
      htmlContent = scrapeResult.html
      sourceName = extractSourceName(itemUrl)
      console.log(
        `📰 Scraped ${extractedText?.length || 0} chars via ${scrapeResult.method} for: ${itemUrl}`,
      )
    }

    if (!extractedText || extractedText.length < 50) {
      console.warn(
        `Insufficient content for URL: ${itemUrl} (${extractedText?.length || 0} chars)`,
      )
      return null
    }

    // ── STEP 2: Extract images and embeds from HTML ──────────────────────
    let imageMarkdown = ''
    let images = []
    let instagramContent = ''
    let facebookContent = ''
    let twitterContent = ''
    let youtubeContent = ''

    if (htmlContent) {
      const imgResult = extractImagesAsMarkdown(htmlContent)
      images = imgResult.images
      imageMarkdown = imgResult.markdown
      console.log(`Found ${images.length} images in article: ${itemUrl}`)

      instagramContent = embeds.extractInstagramEmbeds(htmlContent)
      facebookContent = embeds.extractFacebookEmbeds(htmlContent)
      twitterContent = embeds.extractTwitterEmbeds(htmlContent)
      youtubeContent = embeds.extractYoutubeEmbeds(htmlContent)
    }

    // For social media items, also check item.image and attachments
    let imageUrl = ''
    if (isSocial) {
      imageUrl = item.image || ''
      if (!imageUrl && item.attachments && item.attachments.length > 0) {
        imageUrl = item.attachments[0].url || ''
      }
    }

    // ── STEP 3: Reelaborate text ────────────────────────────────────────
    console.log(`Reelaborating text for: ${itemUrl}`)
    let reelaboratedText = null
    try {
      if (isSocial) {
        reelaboratedText = await reelaborateSocialMediaContent(
          extractedText,
          item,
          sourceName,
        )
      } else {
        reelaboratedText = await reelaborateText(extractedText, imageMarkdown)
      }
    } catch (textError) {
      console.error(`Error reelaborating text: ${textError.message}`)
      reelaboratedText = isSocial
        ? formatSocialMediaAsFallback(extractedText, sourceName, item)
        : formatTextAsFallback(extractedText, imageMarkdown)
    }

    if (!reelaboratedText) {
      reelaboratedText = isSocial
        ? formatSocialMediaAsFallback(extractedText, sourceName, item)
        : formatTextAsFallback(extractedText, imageMarkdown)
      console.warn(`Using fallback formatting for: ${itemUrl}`)
    }

    // ── STEP 4: Generate metadata ───────────────────────────────────────
    console.log(`Generating metadata for: ${itemUrl}`)
    let metadata = null
    try {
      if (isSocial) {
        metadata = await generateSocialMediaMetadata(
          extractedText,
          sourceName,
          item,
        )
      } else {
        metadata = await generateMetadata(extractedText)
      }
    } catch (metaError) {
      console.error(`Error generating metadata: ${metaError.message}`)
      metadata = isSocial
        ? generateFallbackSocialMetadata(extractedText, sourceName, item)
        : generateFallbackMetadata(extractedText)
    }

    if (!metadata) {
      metadata = isSocial
        ? generateFallbackSocialMetadata(extractedText, sourceName, item)
        : generateFallbackMetadata(extractedText)
    }

    // ── STEP 5: Generate tags ───────────────────────────────────────────
    console.log(`Generating tags for: ${itemUrl}`)
    let tags = ''
    try {
      const tagText = isSocial
        ? `${metadata.title} ${metadata.bajada} ${reelaboratedText}`
        : extractedText
      tags = await generateTags(tagText, metadata)
    } catch (tagError) {
      console.error(`Error generating tags: ${tagError.message}`)
      tags = generateFallbackTags(extractedText, metadata)
    }

    // ── STEP 6: Build record fields ─────────────────────────────────────
    const processedText = postProcessText(reelaboratedText)
    const sectionValue = sectionIdToAirtableValue[sectionId] || ''

    // Strip ALL markdown from plain-text fields before Airtable
    const stripPlain = (s) =>
      (s || '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^#+\s*/gm, '')
        .replace(/ {2,}/g, ' ')
        .trim()

    // Image attachments for Airtable
    let imageAttachments = []
    if (images.length > 0) {
      imageAttachments = images.map((url) => ({ url }))
    } else if (imageUrl) {
      imageAttachments = [{ url: imageUrl }]
    } else {
      const attachments = item.attachments || []
      const attachmentUrls = attachments.map((a) => a.url).filter(Boolean)
      if (attachmentUrls.length > 0) {
        imageAttachments = [{ url: attachmentUrls[0] }]
      }
    }

    const recordFields = {
      title: stripPlain(metadata ? metadata.title : item.title),
      overline: stripPlain(metadata ? metadata.volanta : ''),
      excerpt: stripPlain(metadata ? metadata.bajada : ''),
      article: processedText,
      image: imageAttachments,
      author: item.authors?.[0]?.name || '',
      imgUrl: imageUrl || '',
      'article-images':
        imageAttachments.length > 1
          ? imageAttachments
              .slice(1)
              .map((u) => (typeof u === 'string' ? u : u.url))
              .filter(Boolean)
              .join(', ')
          : undefined,
      url: itemUrl,
      source: sourceName,
      'ig-post': instagramContent || '',
      'fb-post': facebookContent || '',
      'tw-post': twitterContent || '',
      'yt-video': youtubeContent || '',
      status: 'draft',
      tags: tags,
    }

    // Primera Plana: include audio field (single line text URL, filled manually in Airtable)
    if (sectionId === 'primera-plana') {
      recordFields.audio = ''
    }

    // Social media items: set the specific social type field to the URL
    if (socialMediaType && itemUrl) {
      recordFields[socialMediaType] = itemUrl
    }

    // Social media items: add extra fields if available
    if (isSocial) {
      recordFields.processingStatus = 'completed'
      if (item.date_published) recordFields.postDate = item.date_published
      try {
        if (item.date_published) {
          recordFields.postDateFormatted = new Date(
            item.date_published,
          ).toLocaleDateString('es-AR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        }
      } catch {}
      if (item.content_html) recordFields.contentHtml = item.content_html
      if (item.id) recordFields.postId = item.id
    }

    console.log(
      `Successfully processed article: ${itemUrl} for section ${sectionId}`,
    )
    return { fields: recordFields }
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

// Start processing (single entry point — uses sectionsToProcess determined at top of file)

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
    const prompt = prompts.generateTags(extractedText, metadata)

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
