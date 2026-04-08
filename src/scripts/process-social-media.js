import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import Airtable from 'airtable'
import { GoogleGenerativeAI } from '@google/generative-ai'
import axios from 'axios' // Add axios for image downloading
import config from '../config/index.js'
import * as prompts from '../prompts/index.js'
import { generateContent } from '../services/ai-service.js'

// Configure environment variables
dotenv.config()

// Create __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Initialize Airtable
const airtableBase = new Airtable({
  apiKey: process.env.AIRTABLE_TOKEN,
}).base(process.env.AIRTABLE_BASE_ID)

// Initialize Gemini vision model for OCR (image text extraction)
const genAI = new GoogleGenerativeAI(config.gemini.apiKey)
const visionModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

// Helper function to create a delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Main function to process social media content
 */
async function processSocialMediaContent(options = {}) {
  const {
    tableName = 'Instituciones',
    limit = 20,
    forceProcess = false,
  } = options

  console.log(`
================================
SOCIAL MEDIA CONTENT PROCESSOR
================================
Table: ${tableName}
Limit: ${limit} records
Force Processing: ${forceProcess ? 'Yes' : 'No'}
  `)

  try {
    // IMPROVED: Include records that need OCR in the filter formula
    let filterFormula = forceProcess
      ? ''
      : "OR({processingStatus} = 'needs_extraction', {isOcrNeeded} = 1)"

    console.log(
      `Fetching records from "${tableName}" with filter: ${filterFormula || 'ALL RECORDS'}`,
    )

    // Get records from Airtable
    const records = await airtableBase(tableName)
      .select({
        maxRecords: limit,
        filterByFormula: filterFormula,
      })
      .all()

    console.log(`Found ${records.length} records to process`)

    // If no records found, check if table has any records
    if (records.length === 0) {
      console.log(
        'No records match the criteria. Checking if table has any records...',
      )

      const checkRecords = await airtableBase(tableName)
        .select({ maxRecords: 5 })
        .all()

      if (checkRecords.length > 0) {
        console.log(
          `Table contains records but none match the filter criteria.`,
        )
        console.log(`Try running with --force to process all records.`)
      } else {
        console.log(`Table "${tableName}" appears to be empty.`)
      }

      return { processed: 0, success: 0, failed: 0 }
    }

    // Process statistics
    const stats = {
      processed: 0,
      success: 0,
      failed: 0,
    }

    // Process each record
    for (const record of records) {
      try {
        console.log(
          `\nProcessing record: ${record.id} - ${record.fields.title || 'Untitled'}`,
        )

        const result = await processRecord(record, tableName)
        stats.processed++

        if (result) {
          stats.success++
          console.log(`Successfully processed record ${record.id}`)
        } else {
          stats.failed++
          console.log(`Failed to process record ${record.id}`)
        }

        // Add delay to avoid rate limiting
        await delay(1000)
      } catch (error) {
        console.error(`Error processing record ${record.id}:`, error)
        stats.processed++
        stats.failed++
      }
    }

    return stats
  } catch (error) {
    console.error('Error in social media processing:', error)
    return { processed: 0, success: 0, failed: 0, error: error.message }
  }
}

/**
 * Process a single record
 */
async function processRecord(record, tableName) {
  try {
    const fields = record.fields
    console.log(`Processing record ${record.id}`)

    // Check if OCR is needed for this record
    const needsOcr = fields.isOcrNeeded === true

    if (needsOcr) {
      console.log('Record is marked for OCR processing')
    }

    // Update processing status
    try {
      await airtableBase(tableName).update(record.id, {
        processingStatus: 'needs_extraction',
        processingNotes: needsOcr
          ? 'Starting OCR and content generation'
          : 'Starting content generation',
      })
    } catch (updateErr) {
      console.error(`Couldn't update processing status: ${updateErr.message}`)
    }

    // Get content from article or contentHtml (prioritize article)
    let rawContent = ''

    if (fields.article && fields.article.trim()) {
      console.log('Using existing article content')
      rawContent = fields.article
    } else if (fields.contentHtml) {
      console.log('Extracting text from HTML content')
      // Simple HTML to text conversion
      rawContent = fields.contentHtml
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    }

    // If no content was found, try to get it from social fields
    if (!rawContent) {
      console.log(
        'No article or HTML content found, checking social media fields',
      )

      // Check all social media fields
      const socialFields = ['ig-post', 'fb-post', 'tw-post', 'yt-video']

      for (const fieldName of socialFields) {
        if (fields[fieldName] && typeof fields[fieldName] === 'string') {
          // If it's a URL, log it but don't use it as content
          if (fields[fieldName].startsWith('http')) {
            console.log(`Field ${fieldName} contains URL: ${fields[fieldName]}`)
            continue
          }

          rawContent = fields[fieldName]
          console.log(
            `Found content in ${fieldName} field (${rawContent.length} chars)`,
          )
          break
        }
      }
    }

    // Check for OCR needs - either explicitly set or we have no content but have an image
    if (needsOcr || (!rawContent && fields.imgUrl)) {
      console.log('Attempting to extract text from image...')

      if (fields.imgUrl) {
        try {
          const imageText = await extractTextFromImage(fields.imgUrl)

          if (imageText && imageText.trim().length > 10) {
            // Ensure we got meaningful text
            console.log(
              `Successfully extracted ${imageText.length} characters from image`,
            )

            // If we already have content, append the image text
            if (rawContent) {
              rawContent += '\n\n[Texto extraído de la imagen:]\n' + imageText
            } else {
              rawContent = imageText
            }

            // Reset OCR flag since we've now processed it
            try {
              await airtableBase(tableName).update(record.id, {
                isOcrNeeded: false,
              })
              console.log('Reset isOcrNeeded flag')
            } catch (resetErr) {
              console.error(`Failed to reset OCR flag: ${resetErr.message}`)
            }
          } else {
            console.log('No significant text found in image')
          }
        } catch (ocrError) {
          console.error(`OCR failed: ${ocrError.message}`)
          // Continue with whatever content we have
        }
      } else {
        console.log('OCR requested but no image URL found')
      }
    }

    // Still no content, mark as failed
    if (!rawContent) {
      console.log('No content found in record')
      try {
        await airtableBase(tableName).update(record.id, {
          processingStatus: 'failed',
          processingNotes: 'No content found in record or image',
        })
      } catch (err) {
        console.error(`Failed to update status: ${err.message}`)
      }
      return false
    }

    console.log(`Raw content length: ${rawContent.length} characters`)

    // Determine source
    const source = fields.source || getSourceFromFields(fields)

    // Generate title, overline, excerpt, and formatted article
    try {
      const generatedContent = await generateAllContentElements(
        rawContent,
        source,
      )

      // Update record with ALL generated content
      const updateFields = {
        processingStatus: 'completed',
        processingNotes: needsOcr
          ? 'Successfully processed with OCR'
          : 'Successfully processed',
      }

      // Always update these fields with fresh content
      // Strip ALL markdown from plain-text fields — only article keeps formatting
      const strip = (s) =>
        s
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .replace(/\*([^*]+)\*/g, '$1')
          .replace(/__([^_]+)__/g, '$1')
          .replace(/_([^_]+)_/g, '$1')
          .replace(/`([^`]+)`/g, '$1')
          .replace(/^#+\s*/gm, '')
          .replace(/ {2,}/g, ' ')
          .trim()
      updateFields.title = strip(generatedContent.title)
      updateFields.overline = strip(generatedContent.overline)
      updateFields.excerpt = strip(generatedContent.excerpt)
      updateFields.article = generatedContent.article

      // Only set source if not already present
      if (!fields.source) {
        updateFields.source = source
      }

      console.log('Updating record with all generated content...')

      try {
        await airtableBase(tableName).update(record.id, updateFields)
        console.log(
          'Record updated successfully with title, excerpt, article and overline',
        )
        return true
      } catch (airtableError) {
        console.error(`Airtable update failed: ${airtableError.message}`)

        // If the update fails, try updating just the core fields
        try {
          console.log('Trying to update with minimal fields...')
          await airtableBase(tableName).update(record.id, {
            title: strip(generatedContent.title),
            excerpt: strip(generatedContent.excerpt),
            processingStatus: 'completed',
          })
          console.log('Minimal update succeeded')
          return true
        } catch (minimalError) {
          console.error(`Even minimal update failed: ${minimalError.message}`)
          return false
        }
      }
    } catch (contentGenError) {
      console.error(`Content generation failed: ${contentGenError.message}`)

      try {
        await airtableBase(tableName).update(record.id, {
          processingStatus: 'error',
          processingNotes: `Content generation failed: ${contentGenError.message.substring(0, 500)}`,
        })
      } catch (e) {
        console.error(`Failed to update error status: ${e.message}`)
      }

      return false
    }
  } catch (error) {
    console.error(`Error processing record:`, error)

    try {
      await airtableBase(tableName).update(record.id, {
        processingStatus: 'error',
        processingNotes: `Error: ${error.message.substring(0, 500)}`,
      })
    } catch (e) {
      console.error('Failed to update error status:', e)
    }

    return false
  }
}

/**
 * Extract text from image using Gemini Vision
 */
async function extractTextFromImage(imageUrl) {
  try {
    console.log(`Extracting text from image: ${imageUrl}`)

    // Fetch the image
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
    })

    const imageData = Buffer.from(response.data).toString('base64')

    // Determine MIME type from URL
    let mimeType = 'image/jpeg'
    if (imageUrl.includes('.png')) mimeType = 'image/png'
    if (imageUrl.includes('.webp')) mimeType = 'image/webp'
    if (imageUrl.includes('.gif')) mimeType = 'image/gif'

    // Call Gemini vision model for OCR
    const result = await visionModel.generateContent([
      {
        inlineData: {
          mimeType: mimeType,
          data: imageData,
        },
      },
      {
        text: 'Extrae TODO el texto visible en esta imagen. Devuelve solo el texto extraído sin explicaciones, comentarios ni código.',
      },
    ])

    const textContent = await result.response.text()

    if (!textContent || textContent.length === 0) {
      console.warn(`No text found in image`)
      return null
    }

    console.log(
      `Successfully extracted ${textContent.length} characters from image`,
    )
    return textContent
  } catch (error) {
    console.error(`Image text extraction failed: ${error.message}`)
    return null
  }
}

/**
 * Generate all content elements using the centralized SEO prompt pipeline.
 * Same approach as the main fetch-to-airtable pipeline.
 */
async function generateAllContentElements(content, source) {
  try {
    console.log('Generating article with SEO approach...')

    // Build minimal feed item for the social media prompt
    const item = {
      authors: source ? [{ name: source }] : [],
      date_published: new Date().toISOString(),
    }

    // Step 1: Generate formatted SEO article
    const articlePrompt = prompts.reelaborateSocialMedia(content, item, source)
    const articleResult = await generateContent(articlePrompt, {
      maxTokens: 8192,
    })

    let article = articleResult.text
      .trim()
      .replace(/^```markdown\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()

    // Remove RRSS references and filler phrases
    article = article
      .replace(
        /\b(según publicó|compartió en|posteó en|difundió en|anunció en|publicó en)\s+(Facebook|Instagram|Twitter|YouTube|redes sociales|la plataforma|su cuenta)\b/gi,
        '',
      )
      .replace(
        /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1FA70}-\u{1FAFF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}]/gu,
        '',
      )
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

    const wordCount = article.split(/\s+/).filter((w) => w.length > 0).length
    console.log(`Generated article: ${wordCount} words`)

    // Step 2: Generate SEO metadata from the article
    const metadataSource = article.length > 100 ? article : content
    const metadataPrompt = prompts.generateSocialMediaMetadata(metadataSource)
    const metadataResult = await generateContent(metadataPrompt, {
      maxTokens: 1024,
    })

    let title = ''
    let overline = ''
    let excerpt = ''

    try {
      let cleanJson = metadataResult.text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim()

      // Extract JSON object even if surrounded by text
      const startIdx = cleanJson.indexOf('{')
      const endIdx = cleanJson.lastIndexOf('}')
      if (startIdx !== -1 && endIdx !== -1) {
        cleanJson = cleanJson
          .substring(startIdx, endIdx + 1)
          .replace(/,\s*}/g, '}')
          .replace(/\n/g, ' ')
          .replace(/\r/g, '')
          .replace(/\t/g, ' ')
      }

      const parsed = JSON.parse(cleanJson)
      if (parsed.title) title = parsed.title
      if (parsed.volanta) overline = parsed.volanta
      if (parsed.bajada) excerpt = parsed.bajada
      console.log(`Generated metadata: "${title}" | "${overline}"`)
    } catch (parseError) {
      console.warn(
        `Metadata JSON parse failed: ${parseError.message}, using fallbacks`,
      )
    }

    // Fallbacks only if AI returned nothing
    if (!title) {
      const firstSentence = (article || content).split(/[.\n]/)[0]?.trim() || ''
      title =
        firstSentence.length > 70
          ? firstSentence.substring(0, firstSentence.lastIndexOf(' ', 70) || 70)
          : firstSentence
    }
    if (!overline) overline = 'Institucionales'
    if (!excerpt) {
      const plainArticle = (article || content)
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/^#+\s*/gm, '')
      const sentences = plainArticle
        .split(/[.!?]+/)
        .filter((s) => s.trim().length > 20)
      excerpt = sentences.slice(0, 2).join('. ').trim()
      if (excerpt && !excerpt.endsWith('.')) excerpt += '.'
    }

    return { title, overline, excerpt, article }
  } catch (error) {
    console.error('Error generating content elements:', error)

    return {
      title: createBasicTitle(content, source),
      overline: 'Institucionales',
      excerpt: content.substring(0, 150),
      article: formatRawContent(content, source),
    }
  }
}

/**
 * Create a basic title from content when AI fails
 */
function createBasicTitle(content, source) {
  try {
    const firstLine = content.split(/[\n\r.!?]+/)[0].trim()
    if (firstLine.length <= 70) return firstLine
    const cut = firstLine.lastIndexOf(' ', 70)
    return firstLine.substring(0, cut > 30 ? cut : 70)
  } catch (e) {
    return `Publicación de ${source || 'Redes Sociales'}`
  }
}

/**
 * Format raw content into a presentable article when AI fails
 */
function formatRawContent(content, source) {
  // Add basic structure to the content
  const dateStr = new Date().toLocaleDateString('es-AR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return `${content}

---

Fuente: ${source || 'Redes Sociales'}
Fecha de publicación: ${dateStr}`
}

/**
 * Get source from social media fields
 */
function getSourceFromFields(fields) {
  if (fields.source) return fields.source
  if (fields['ig-post']) return 'Instagram'
  if (fields['fb-post']) return 'Facebook'
  if (fields['tw-post']) return 'Twitter'
  if (fields['yt-video']) return 'YouTube'
  return 'Redes Sociales'
}

// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const options = {
    tableName: args.find((arg) => !arg.startsWith('--')) || 'Instituciones',
    limit: parseInt(
      args.find((arg) => arg.startsWith('--limit='))?.split('=')[1] || '20',
    ),
    forceProcess: args.includes('--force'),
  }

  processSocialMediaContent(options)
    .then((stats) => {
      console.log('\n=== Processing Complete ===')
      console.log(`Processed: ${stats.processed} records`)
      console.log(`Successful: ${stats.success} records`)
      console.log(`Failed: ${stats.failed} records`)
      process.exit(0)
    })
    .catch((error) => {
      console.error('Script failed:', error)
      process.exit(1)
    })
}

export { processSocialMediaContent }
