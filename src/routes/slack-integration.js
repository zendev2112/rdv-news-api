import express from 'express'
import Airtable from 'airtable'
import axios from 'axios'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { GoogleGenerativeAI } from '@google/generative-ai'
import * as cheerio from 'cheerio'
import fetch from 'node-fetch'

// Track processing URLs to prevent infinite loops
const processingUrls = new Set()

const slackRoutes = express.Router()

// Initialize Airtable
const airtable = new Airtable({ apiKey: process.env.AIRTABLE_TOKEN })
const base = airtable.base(process.env.AIRTABLE_BASE_ID)

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const model = genAI.getGenerativeModel({
  model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
})

// Constants
const API_DELAY = 3000 // 3 seconds delay between AI calls

// Utility functions
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
 * Extract images from HTML content
 */
function extractImagesAsMarkdown(htmlContent) {
  try {
    const $ = cheerio.load(htmlContent)
    const extractedImages = []
    let imageMarkdown = ''

    // Extract figures with captions
    $('figure').each((i, figure) => {
      const $figure = $(figure)
      const $img = $figure.find('img')
      const $caption = $figure.find('figcaption')

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

        const caption = $caption.text().trim()
        extractedImages.push(imageUrl)
        imageMarkdown += `**Imagen:** ${caption}\n\n`
      }
    })

    console.log(
      `Extracted ${extractedImages.length} captioned images from HTML content`
    )

    return {
      images: extractedImages,
      markdown: imageMarkdown,
    }
  } catch (error) {
    console.error('Error extracting images:', error.message)
    return { images: [], markdown: '' }
  }
}

/**
 * Extract embeds from HTML content
 */
function extractEmbeds(htmlContent) {
  const $ = cheerio.load(htmlContent)

  const embeds = {
    instagram: '',
    facebook: '',
    twitter: '',
    youtube: '',
  }

  // Instagram embeds
  $('blockquote[class*="instagram"], iframe[src*="instagram.com"]').each(
    (i, elem) => {
      const $elem = $(elem)
      if ($elem.is('blockquote')) {
        embeds.instagram = $.html($elem)
      } else if ($elem.is('iframe')) {
        embeds.instagram = $elem.attr('src') || ''
      }
    }
  )

  // Facebook embeds
  $('iframe[src*="facebook.com"], div[class*="fb-post"]').each((i, elem) => {
    const $elem = $(elem)
    if ($elem.is('iframe')) {
      embeds.facebook = $elem.attr('src') || ''
    } else {
      embeds.facebook = $.html($elem)
    }
  })

  // Twitter embeds
  $(
    'blockquote[class*="twitter"], iframe[src*="twitter.com"], iframe[src*="x.com"]'
  ).each((i, elem) => {
    const $elem = $(elem)
    if ($elem.is('blockquote')) {
      embeds.twitter = $.html($elem)
    } else if ($elem.is('iframe')) {
      embeds.twitter = $elem.attr('src') || ''
    }
  })

  // YouTube embeds
  $('iframe[src*="youtube.com"], iframe[src*="youtu.be"]').each((i, elem) => {
    const $elem = $(elem)
    embeds.youtube = $elem.attr('src') || ''
  })

  return embeds
}

/**
 * Extract source name from URL
 */
function extractSourceName(url) {
  try {
    if (!url) return 'Unknown Source'

    const hostname = new URL(url).hostname
    let domain = hostname
      .replace(/^www\./, '')
      .replace(/^m\./, '')
      .replace(/^mobile\./, '')
      .replace(/^news\./, '')
      .replace(/^noticias\./, '')

    // Handle social media
    if (domain.includes('facebook.com')) return 'Facebook'
    if (domain.includes('instagram.com')) return 'Instagram'
    if (domain.includes('twitter.com') || domain.includes('x.com'))
      return 'Twitter'
    if (domain.includes('youtube.com') || domain.includes('youtu.be'))
      return 'YouTube'

    // Strip common TLDs
    domain = domain.replace(
      /\.(com|co|net|org|info|ar|mx|es|cl|pe|br|uy|py|bo|ec|ve|us|io|tv|app|web|digital|news|online|press|media|blog|site)(\.[a-z]{2,3})?$/,
      ''
    )

    const parts = domain.split('.')
    let sourceName = parts[0]

    // Domain mapping
    const domainMapping = {
      lanacion: 'La Nación',
      eldiario: 'El Diario',
      pagina12: 'Página 12',
      clarin: 'Clarín',
      infobae: 'Infobae',
      ambito: 'Ámbito',
      tn: 'Todo Noticias',
    }

    if (domainMapping[sourceName]) {
      return domainMapping[sourceName]
    }

    return sourceName
      .split(/[-_]/)
      .map((word) => {
        if (word.length === 1) return word.toUpperCase()
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      })
      .join(' ')
  } catch (error) {
    console.error(`Error extracting source name from ${url}:`, error.message)
    return 'Unknown Source'
  }
}

/**
 * Post-process text to fix formatting issues
 */
function postProcessText(text) {
  let fixed = text.replace(/^\s*-\s+/gm, '- ')
  fixed = fixed.replace(/^\s*(\d+)\.\s+/gm, '$1. ')
  fixed = fixed.replace(/^#+\s+/gm, '## ')
  fixed = fixed.replace(/\*\*([^*]+)\*\*/g, '**$1**')
  fixed = fixed.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  fixed = fixed.replace(/\*([^*]+)\*/g, '*$1*')
  return fixed
}

/**
 * AI Functions - Generate metadata, reelaborate text, generate tags and social media text
 */
async function generateMetadata(extractedText) {
  try {
    console.log(`Generating metadata...`)
    await delay(API_DELAY)

    const prompt = `
      Extracted Text: "${extractedText.substring(0, 5000)}"
      
      Basado en el texto anterior, genera lo siguiente:
      1. Un título conciso y atractivo. **No uses mayúsculas en todas las palabras** (evita el title case). Solo usa mayúsculas al principio del título y en nombres propios.
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
    console.error(`Error generating metadata:`, error.message)
    return {
      title: 'Artículo sin título',
      bajada: 'Sin descripción disponible',
      volanta: 'Noticias',
    }
  }
}

async function reelaborateText(extractedText, imageMarkdown = '') {
  try {
    console.log(`Reelaborating text...`)
    await delay(API_DELAY)

    const imagesPrompt = imageMarkdown
      ? 'Las siguientes descripciones de imágenes fueron extraídas del artículo original. Intégralas en el texto reelaborado en los lugares más apropiados según el contexto:\n\n' +
        imageMarkdown
      : ''

    const prompt = `
      Reelaborar la siguiente noticia siguiendo estas pautas:

      1. **Lenguaje**: Utilizar un **español rioplatense formal**, adecuado para un contexto periodístico.
      2. **Objetividad**: Mantener un tono neutral y objetivo.
      3. **Claridad**: Usar un lenguaje sencillo y accesible.
      4. **Estructura**: OBLIGATORIO: Dividir el texto en secciones con subtítulos claros usando formato markdown (## Subtítulo).
      5. **Sintaxis**: OBLIGATORIO: Incorporar elementos visuales como:
         - OBLIGATORIO: INCLUIR AL MENOS UNA LISTA con viñetas:
           - Primer punto clave
           - Segundo punto clave 
           - Tercer punto clave
         - OBLIGATORIO: Usar **negritas** para resaltar información importante.
         - OBLIGATORIO: Si hay citas textuales, usar el formato: > Cita textual
      6. **Formato Markdown**: ABSOLUTAMENTE OBLIGATORIO usar correctamente estos elementos.
      7. **Títulos**: No incluir un título principal (# Título). Comenzar directamente con el cuerpo del texto.
      
      ${imagesPrompt}
      
      Texto extraído: "${extractedText.substring(0, 5000)}"
    `

    const result = await model.generateContent(prompt)
    const response = await result.response
    const text = response.text()

    return postProcessText(text)
  } catch (error) {
    console.error(`Error reelaborating text:`, error.message)
    return extractedText // Fallback to original text
  }
}

async function generateTags(extractedText, metadata) {
  try {
    console.log(`Generating tags...`)
    await delay(API_DELAY)

    const title = metadata?.title || ''
    const bajada = metadata?.bajada || ''

    const prompt = `
      Analiza este artículo y genera entre 5 y 8 etiquetas (tags) relevantes.

      TÍTULO: ${title}
      BAJADA: ${bajada}
      CONTENIDO: "${extractedText.substring(0, 4000)}"
      
      INSTRUCCIONES:
      1. Identifica nombres propios importantes (personas, lugares, organizaciones).
      2. Identifica temas principales y subtemas.
      3. Cada etiqueta debe tener entre 1 y 3 palabras.
      4. NO utilices hashtags (#).
      5. Las etiquetas deben ser específicas pero no muy largas.
      
      Devuelve SOLO un array de strings en formato JSON:
      ["etiqueta1", "etiqueta2", "etiqueta3", ...]
    `

    const result = await model.generateContent(prompt)
    const response = await result.response
    const text = response.text()

    const jsonMatch = text.match(/\[.*?\]/s)
    if (!jsonMatch) {
      throw new Error('No valid JSON array found in response')
    }

    const cleanedJson = jsonMatch[0].replace(/```json|```/g, '').trim()
    const tags = JSON.parse(cleanedJson)

    if (!Array.isArray(tags) || tags.length === 0) {
      throw new Error('Generated tags are not in expected format')
    }

    const formattedTags = tags.map((tag) =>
      tag
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    )

    return formattedTags.join(', ')
  } catch (error) {
    console.error(`Error generating tags:`, error.message)
    return 'Noticias' // Fallback
  }
}

async function generateSocialMediaText(extractedText, metadata, tags) {
  try {
    console.log(`Generating social media text...`)
    await delay(API_DELAY)

    const title = metadata?.title || ''
    const bajada = metadata?.bajada || ''

    const prompt = `
      Crea un texto atractivo para redes sociales de MENOS DE 500 CARACTERES que promocione este artículo.

      TÍTULO: ${title}
      BAJADA: ${bajada}
      ETIQUETAS: ${tags}
      
      INSTRUCCIONES:
      1. El texto DEBE tener MENOS DE 500 CARACTERES en total.
      2. Escribe en español rioplatense con tono conversacional.
      3. Incluye 2-4 emojis estratégicamente ubicados.
      4. Termina con 3-5 hashtags relevantes al contenido.
      5. Usa frases cortas y directas que generen interés.
      
      Devuelve SOLO el texto para redes sociales.
    `

    const result = await model.generateContent(prompt)
    const response = await result.response
    let socialText = response.text().trim()

    socialText = socialText.replace(/^```[\s\S]*```$/gm, '').trim()

    if (socialText.length > 500) {
      socialText = socialText.substring(0, 497) + '...'
    }

    return socialText
  } catch (error) {
    console.error(`Error generating social media text:`, error.message)
    return `📰 ${metadata?.title || 'Nuevo artículo'} #Noticias`
  }
}

/**
 * Send update to Slack channel
 */
async function sendSlackUpdate(
  channel,
  message,
  color = 'good',
  attachment = null
) {
  try {
    // Validate channel
    if (!channel) {
      console.error('Invalid channel provided to sendSlackUpdate')
      channel = 'general' // Fallback to general channel
    }

    // Ensure channel doesn't have duplicate # prefix
    const formattedChannel = channel.startsWith('#') ? channel : `#${channel}`

    const slackMessage = {
      channel: formattedChannel,
      text: message || 'Article processing update',
      attachments: attachment
        ? [{ color, ...attachment }]
        : [{ color, text: message }],
    }

    console.log(`Sending Slack update to ${formattedChannel}`)

    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify(slackMessage),
    })

    const result = await response.json()

    if (!result.ok) {
      console.error('Slack API error:', result.error)
    } else {
      console.log('Slack update sent successfully')
    }
  } catch (error) {
    console.error('Error sending Slack update:', error)
  }
}




// Request logging middleware
slackRoutes.use((req, res, next) => {
  console.log('=== SLACK REQUEST ===')
  console.log('Path:', req.path)
  console.log('Method:', req.method)
  console.log('Body:', req.body)
  console.log('====================')
  next()
})

// Replace your current /enviar-noticia endpoint with this
slackRoutes.post('/enviar-noticia', async (req, res) => {
  try {
    const { channel_name, user_name, text } = req.body

    if (!text || text.trim() === '') {
      return res.json({
        response_type: 'ephemeral',
        text: '❌ Usage: /enviar-noticia <URL>\nExample: /enviar-noticia https://example.com/article',
      })
    }

    const url = text.trim().split(' ')[0]
    const requestId = Date.now()

    // Validate URL
    try {
      new URL(url)
    } catch (urlError) {
      return res.json({
        response_type: 'ephemeral',
        text: '❌ Please provide a valid URL\nExample: /enviar-noticia https://example.com/article',
      })
    }

    // Respond immediately to Slack
    res.json({
      response_type: 'in_channel',
      text: `🔄 Processing article from ${extractSourceName(url)}...`,
      attachments: [
        {
          color: 'warning',
          fields: [
            { title: 'URL', value: url, short: false },
            { title: 'Requested by', value: user_name, short: true },
            { title: 'Status', value: 'Starting processing...', short: true },
          ],
        },
      ],
    })

    // Process sequentially like fetch-to-airtable
    setTimeout(async () => {
      await processNewsArticleSequential(url, user_name, channel_name, requestId)
    }, 100)

  } catch (error) {
    console.error('Error in enviar-noticia command:', error)
    return res.json({
      response_type: 'ephemeral',
      text: `❌ Error: ${error.message}`,
    })
  }
})

// For GET requests to the same endpoint (browser access)
slackRoutes.get('/enviar-noticia', (req, res) => {
  res.json({
    message: 'This endpoint requires a POST request from Slack',
    usage: '/enviar-noticia <URL>',
  })
})

// Basic health check
slackRoutes.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Slack integration is running',
    envVars: {
      hasAirtableToken: !!process.env.AIRTABLE_TOKEN,
      hasAirtableBaseId: !!process.env.AIRTABLE_BASE_ID,
      hasGeminiApiKey: !!process.env.GEMINI_API_KEY,
      hasSlackToken: !!process.env.SLACK_BOT_TOKEN,
    },
  })
})

// Replace your current step-based approach with this single processing function
async function processNewsArticleSequential(url, user_name, channel_name, processId) {
  try {
    console.log(`[${processId}] === STARTING SEQUENTIAL PROCESSING ===`)
    console.log(`[${processId}] URL: ${url}`)
    console.log(`[${processId}] User: ${user_name}`)
    console.log(`[${processId}] Channel: ${channel_name}`)

    // Step 1: Fetch and extract content
    console.log(`[${processId}] Step 1: Fetching content...`)
    await sendSlackUpdate(channel_name, `📄 Extracting content from ${extractSourceName(url)}...`, 'good')
    
    const htmlContent = await fetchContent(url)
    if (!htmlContent) {
      throw new Error('Failed to fetch HTML content')
    }

    const { images, markdown: imageMarkdown } = extractImagesAsMarkdown(htmlContent)
    const extractedText = extractText(htmlContent)
    const embeds = extractEmbeds(htmlContent)
    const sourceName = extractSourceName(url)

    if (extractedText.length < 50) {
      throw new Error('Insufficient content extracted')
    }

    console.log(`[${processId}] ✅ Content extracted: ${extractedText.length} chars, ${images.length} images`)

    // Step 2: Generate metadata with AI
    console.log(`[${processId}] Step 2: Generating metadata...`)
    await sendSlackUpdate(channel_name, `🤖 Generating metadata...`, 'good')
    
    const metadata = await generateMetadata(extractedText)
    console.log(`[${processId}] ✅ Metadata generated:`, metadata.title)

    // Step 3: Reelaborate text
    console.log(`[${processId}] Step 3: Reelaborating text...`)
    await sendSlackUpdate(channel_name, `✍️ Reelaborating text...`, 'good')
    
    const reelaboratedText = await reelaborateText(extractedText, imageMarkdown)
    console.log(`[${processId}] ✅ Text reelaborated: ${reelaboratedText.length} characters`)

    // Step 4: Generate tags
    console.log(`[${processId}] Step 4: Generating tags...`)
    await sendSlackUpdate(channel_name, `🏷️ Generating tags...`, 'good')
    
    const tags = await generateTags(extractedText, metadata)
    console.log(`[${processId}] ✅ Tags generated: ${tags}`)

    // Step 5: Generate social media text
    console.log(`[${processId}] Step 5: Generating social media text...`)
    const socialMediaText = await generateSocialMediaText(extractedText, metadata, tags)
    console.log(`[${processId}] ✅ Social media text generated`)

    // Step 6: Prepare for Airtable
    console.log(`[${processId}] Step 6: Preparing Airtable record...`)
    await sendSlackUpdate(channel_name, `💾 Saving to Airtable...`, 'good')

    const imageAttachments = images.length > 0 ? images.map((imageUrl) => ({ url: imageUrl })) : []

    // Get next ID
    const existingRecords = await base('Slack Noticias')
      .select({
        fields: ['id'],
        sort: [{ field: 'id', direction: 'desc' }],
        maxRecords: 1,
      })
      .firstPage()

    const nextId = existingRecords.length > 0 ? (existingRecords[0].fields.id || 0) + 1 : 1

    const recordFields = {
      id: nextId,
      title: metadata.title,
      overline: metadata.volanta,
      excerpt: metadata.bajada,
      article: reelaboratedText,
      image: imageAttachments,
      imgUrl: images.length > 0 ? images[0] : '',
      'article-images': images.join(', '),
      url: url,
      source: sourceName,
      'ig-post': embeds.instagram || '',
      'fb-post': embeds.facebook || '',
      'tw-post': embeds.twitter || '',
      'yt-video': embeds.youtube || '',
      status: 'draft',
      section: 'draft',
      tags: tags,
      socialMediaText: socialMediaText,
      front: '',
      order: 'normal',
    }

    console.log(`[${processId}] Step 7: Creating Airtable record...`)
    const record = await base('Slack Noticias').create(recordFields)
    console.log(`[${processId}] ✅ Successfully created record ${record.id}`)

    // Final success notification
    await sendSlackUpdate(channel_name, null, 'good', {
      text: `✅ Article processed successfully!`,
      fields: [
        { title: 'Title', value: metadata.title, short: false },
        { title: 'Source', value: sourceName, short: true },
        { title: 'Record ID', value: record.id, short: true },
        { title: 'Tags', value: tags.substring(0, 100), short: false },
      ],
      actions: [
        {
          type: 'button',
          text: 'View in Airtable',
          url: `https://airtable.com/${process.env.AIRTABLE_BASE_ID}/Slack%20Noticias/${record.id}`,
          style: 'primary',
        },
      ],
    })

    console.log(`[${processId}] === PROCESSING COMPLETE ===`)

  } catch (error) {
    console.error(`[${processId}] ❌ Error in sequential processing:`, error)
    await sendSlackUpdate(channel_name, `❌ Error processing article: ${error.message}`, 'danger')
  }
}

export default slackRoutes