import express from 'express'
import Airtable from 'airtable'
import axios from 'axios'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { GoogleGenerativeAI } from '@google/generative-ai'
import * as cheerio from 'cheerio'
import fetch from 'node-fetch'
import logger from '../utils/logger.js'

const slackRoutes = express.Router()

// Initialize Airtable
const airtable = new Airtable({ apiKey: process.env.AIRTABLE_TOKEN })
const base = airtable.base(process.env.AIRTABLE_BASE_ID)

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const model = genAI.getGenerativeModel({
  model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
})

// Constants for processing
const API_DELAY = 3000 // 3 seconds delay between AI calls

// Utility functions from fetch-to-airtable.js
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Extracts images from HTML and creates markdown references
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

        imageMarkdown += `**Imagen:** ${caption}\n\n`
      }
    })

    console.log(
      `Extracted ${extractedImages.length} captioned images from HTML content`
    )

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
  let fixed = text.replace(/^\s*-\s+/gm, '- ')
  fixed = fixed.replace(/^\s*(\d+)\.\s+/gm, '$1. ')
  fixed = fixed.replace(/^#+\s+/gm, '## ')
  fixed = fixed.replace(/\*\*([^*]+)\*\*/g, '**$1**')
  fixed = fixed.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  fixed = fixed.replace(/\*([^*]+)\*/g, '*$1*')
  return fixed
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
 * Generate metadata using AI
 */
async function generateMetadata(extractedText, maxRetries = 3) {
  let retries = 0
  while (retries < maxRetries) {
    try {
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
      console.error(`Error generating metadata:`, error.message)
      retries++
      if (retries >= maxRetries) {
        return {
          title: 'Artículo sin título',
          bajada: 'Sin descripción disponible',
          volanta: 'Noticias',
        }
      }
      await delay(3000)
    }
  }
}

/**
 * Reelaborate text using AI
 */
async function reelaborateText(
  extractedText,
  imageMarkdown = '',
  maxRetries = 3
) {
  let retries = 0
  while (retries < maxRetries) {
    try {
      const delayTime = API_DELAY * Math.pow(1.5, retries)
      console.log(
        `Waiting ${delayTime / 1000} seconds before reelaborating text...`
      )
      await delay(delayTime)

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
      let text = response.text()

      // Check if text has proper formatting
      const hasHeadings = text.includes('## ')
      const hasList = text.includes('- ')

      if (!hasHeadings || !hasList) {
        console.warn('Generated text is missing proper formatting, retrying...')
        retries++
        continue
      }

      return postProcessText(text)
    } catch (error) {
      console.error(`Error reelaborating text:`, error.message)
      retries++
      if (retries >= maxRetries) {
        return extractedText // Fallback to original text
      }
      await delay(3000)
    }
  }
}

/**
 * Generate tags using AI
 */
async function generateTags(extractedText, metadata, maxRetries = 3) {
  let retries = 0
  while (retries < maxRetries) {
    try {
      const delayTime = API_DELAY * Math.pow(1.5, retries)
      await delay(delayTime)

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
      retries++
      if (retries >= maxRetries) {
        return 'Noticias' // Fallback
      }
      await delay(2000)
    }
  }
}

/**
 * Generate social media text
 */
async function generateSocialMediaText(
  extractedText,
  metadata,
  tags,
  maxRetries = 3
) {
  let retries = 0
  while (retries < maxRetries) {
    try {
      const delayTime = API_DELAY * Math.pow(1.5, retries)
      await delay(delayTime)

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
      retries++
      if (retries >= maxRetries) {
        return `📰 ${metadata?.title || 'Nuevo artículo'} #Noticias`
      }
      await delay(2000)
    }
  }
}

/**
 * Send update to Slack channel
 */
async function sendSlackUpdate(channel, message, color = 'good', attachment = null) {
  try {
    // Ensure channel doesn't have duplicate # prefix
    const formattedChannel = channel.startsWith('#') ? channel : `#${channel}`
    
    const slackMessage = {
      channel: formattedChannel,
      text: message || 'Article processing update',
      attachments: attachment ? [{ color, ...attachment }] : [{ color, text: message }]
    }
    
    console.log(`Sending Slack update to ${formattedChannel}`)
    
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
      },
      body: JSON.stringify(slackMessage)
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

// Your existing routes
slackRoutes.get('/test', (req, res) => {
  res.json({ message: 'Slack integration working!' })
})

slackRoutes.use((req, res, next) => {
  console.log('=== SLACK REQUEST DEBUG ===')
  console.log('Body:', req.body)
  console.log('========================')
  next()
})

slackRoutes.post('/social-task', async (req, res) => {
  try {
    const { channel_name, user_name, text } = req.body

    if (!text || text.trim() === '') {
      return res.json({
        response_type: 'ephemeral',
        text: '❌ Usage: /social-task "Your news headline here"',
      })
    }

    const title = text.replace(/^["']|["']$/g, '').trim()

    if (title.length < 5) {
      return res.json({
        response_type: 'ephemeral',
        text: '❌ Title must be at least 5 characters long',
      })
    }

    const record = await base('Redes Sociales').create({
      Title: title,
      Status: 'Draft',
      Source: 'Slack',
      'Created By': user_name || 'Unknown',
      Notes: `Created from Slack by ${user_name} in #${channel_name}`,
    })

    return res.json({
      response_type: 'in_channel',
      text: `📱 Social media task created successfully!`,
      attachments: [
        {
          color: 'good',
          fields: [
            { title: 'Title', value: title, short: false },
            { title: 'Created by', value: user_name || 'Unknown', short: true },
            { title: 'Record ID', value: record.id, short: true },
          ],
        },
      ],
    })
  } catch (error) {
    console.error('Error creating social task from Slack:', error)
    return res.json({
      response_type: 'ephemeral',
      text: `❌ Error creating task: ${error.message}`,
    })
  }
})


/**
 * NEW COMMAND: Process and send news article
 * Usage: /enviar-noticia https://example.com/article
 */
slackRoutes.post('/enviar-noticia', async (req, res) => {
  try {
    const { channel_name, user_name, text } = req.body
    
    if (!text || text.trim() === '') {
      return res.json({
        response_type: 'ephemeral',
        text: '❌ Usage: /enviar-noticia <URL>\nExample: /enviar-noticia https://lanacion.com.ar/politica/nueva-ley-aprobada',
      })
    }
    
    const url = text.trim().split(' ')[0]
    
    try {
      new URL(url)
    } catch (urlError) {
      return res.json({
        response_type: 'ephemeral',
        text: '❌ Please provide a valid URL\nExample: /enviar-noticia https://lanacion.com.ar/article',
      })
    }
    
    // Respond immediately to Slack to avoid timeout
    res.json({
      response_type: 'in_channel',
      text: `🔄 Starting to process article from ${extractSourceName(url)}...`,
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
    
    // Process the article in the background after responding to Slack
    // Use setTimeout to ensure this runs outside the request-response cycle
    setTimeout(() => {
      console.log(`Starting background processing for ${url} requested by ${user_name}`)
      processNewsArticle(url, user_name, channel_name)
        .then(() => console.log(`Successfully processed article: ${url}`))
        .catch(err => console.error(`Failed to process article ${url}:`, err))
    }, 100)
    
  } catch (error) {
    console.error('Error in enviar-noticia command:', error)
    return res.json({
      response_type: 'ephemeral',
      text: `❌ Error: ${error.message}`,
    })
  }
})

// NEW ROUTE: Add this separate endpoint to handle the processing
slackRoutes.post('/process-article', async (req, res) => {
  // For security
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || 'secret'}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  
  const { url, user_name, channel_name } = req.body
  
  // Respond immediately
  res.status(200).json({ status: 'Processing started' })
  
  // Process in background
  processNewsArticle(url, user_name, channel_name).catch(error => {
    console.error('Background processing error:', error)
  })
})

/**
 * Process news article asynchronously
 */
async function processNewsArticle(url, user_name, channel_name) {
  try {
    console.log(`=== STARTING ARTICLE PROCESSING ===`)
    console.log(`URL: ${url}`)
    console.log(`User: ${user_name}`)
    console.log(`Channel: ${channel_name}`)
    
    // Send initial confirmation to the channel
    await sendSlackUpdate(
      channel_name,
      `🔄 Processing started for article: ${url}`,
      'good',
      {
        fields: [
          { title: 'URL', value: url, short: false },
          { title: 'Requested by', value: user_name, short: true },
          { title: 'Status', value: 'Processing started', short: true },
        ],
      }
    )

    // Step 1: Fetch HTML content
    console.log('Step 1: Fetching HTML content...')
    const htmlContent = await fetchContent(url)
    if (!htmlContent) {
      console.error('❌ Failed to fetch HTML content')
      await sendSlackUpdate(
        channel_name,
        `❌ Failed to fetch content from ${url}`,
        'danger'
      )
      return
    }
    console.log(`✅ HTML content fetched: ${htmlContent.length} characters`)

    // Step 2: Extract images and text
    console.log('Step 2: Extracting images and text...')
    const { images, markdown: imageMarkdown } = extractImagesAsMarkdown(htmlContent)
    console.log(`✅ Images extracted: ${images.length} images`)
    
    const extractedText = extractText(htmlContent)
    console.log(`✅ Text extracted: ${extractedText.length} characters`)

    if (!extractedText || extractedText.length < 50) {
      console.error('❌ Insufficient content extracted')
      await sendSlackUpdate(
        channel_name,
        `❌ Insufficient content extracted from ${url}. Only ${extractedText.length} characters found.`,
        'danger'
      )
      return
    }

    // Step 3: Extract embeds
    console.log('Step 3: Extracting embeds...')
    const embeds = extractEmbeds(htmlContent)
    console.log(`✅ Embeds extracted:`, Object.keys(embeds).filter(key => embeds[key]))

    // Step 4: Generate metadata
    console.log('Step 4: Generating metadata with AI...')
    const metadata = await generateMetadata(extractedText)
    console.log(`✅ Metadata generated:`, metadata)

    // Step 5: Reelaborate text
    console.log('Step 5: Reelaborating text with AI...')
    const reelaboratedText = await reelaborateText(extractedText, imageMarkdown)
    console.log(`✅ Text reelaborated: ${reelaboratedText.length} characters`)

    // Step 6: Generate tags
    console.log('Step 6: Generating tags with AI...')
    const tags = await generateTags(extractedText, metadata)
    console.log(`✅ Tags generated: ${tags}`)

    // Step 7: Generate social media text
    console.log('Step 7: Generating social media text with AI...')
    const socialMediaText = await generateSocialMediaText(extractedText, metadata, tags)
    console.log(`✅ Social media text generated: ${socialMediaText.length} characters`)

    // Step 8: Prepare Airtable record
    console.log('Step 8: Preparing Airtable record...')
    const sourceName = extractSourceName(url)
    console.log(`✅ Source name: ${sourceName}`)

    // Format image attachments for Airtable
    const imageAttachments = images.length > 0 ? images.map((imageUrl) => ({ url: imageUrl })) : []
    console.log(`✅ Image attachments prepared: ${imageAttachments.length}`)

    // Generate next ID for the record
    console.log('Step 8a: Getting next ID...')
    const existingRecords = await base('Slack Noticias')
      .select({
        fields: ['id'],
        sort: [{ field: 'id', direction: 'desc' }],
        maxRecords: 1,
      })
      .firstPage()

    const nextId = existingRecords.length > 0 ? (existingRecords[0].fields.id || 0) + 1 : 1
    console.log(`✅ Next ID: ${nextId}`)

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

    console.log('Step 9: Creating Airtable record...')
    console.log('Record fields:', JSON.stringify(recordFields, null, 2))

    // Step 9: Insert into Airtable
    const record = await base('Slack Noticias').create(recordFields)
    console.log(`✅ Successfully created record ${record.id} in Slack Noticias table`)

    // Step 10: Send success notification to Slack
    console.log('Step 10: Sending success notification...')
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

    console.log(`=== PROCESSING COMPLETE ===`)

  } catch (error) {
    console.error('❌ Critical Error in processNewsArticle:', error)
    console.error('Error stack:', error.stack)
    
    // Log more details for troubleshooting
    console.error('Error details:', {
      url,
      user_name,
      channel_name,
      errorName: error.name,
      errorMessage: error.message,
    })
    
    // Add logging for Slack notification attempt
    try {
      await sendSlackUpdate(
        channel_name,
        `❌ Critical error processing article: ${error.message}`,
        'danger',
        {
          fields: [
            { title: 'URL', value: url, short: false },
            { title: 'Error', value: error.message, short: false },
            { title: 'Type', value: error.name, short: true },
          ],
        }
      )
      console.log('Error notification sent to Slack')
    } catch (slackError) {
      console.error('Failed to send error notification to Slack:', slackError)
    }
  }
}

// Add debug route for environment variables
slackRoutes.get('/debug-env', (req, res) => {
  res.json({
    hasAirtableToken: !!process.env.AIRTABLE_TOKEN,
    hasAirtableBaseId: !!process.env.AIRTABLE_BASE_ID,
    hasGeminiApiKey: !!process.env.GEMINI_API_KEY,
    hasSlackBotToken: !!process.env.SLACK_BOT_TOKEN,
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    nodeEnv: process.env.NODE_ENV
  })
})

// Add debug route for the enviar-noticia endpoint
slackRoutes.get('/debug-enviar-noticia', async (req, res) => {
  const testUrl = req.query.url || 'https://www.pagina12.com.ar/828737-cristina-kirchner-advirtio-la-inminencia-de-un-default-y-lla'
  
  try {
    // Test the initial fetch and parse steps
    console.log('Debugging enviar-noticia with URL:', testUrl)
    
    // Fetch HTML
    const htmlContent = await fetchContent(testUrl)
    
    if (!htmlContent) {
      return res.json({
        success: false,
        error: 'Failed to fetch HTML content',
        step: 'fetchContent'
      })
    }
    
    // Extract images and text
    const { images, markdown: imageMarkdown } = extractImagesAsMarkdown(htmlContent)
    const extractedText = extractText(htmlContent)
    
    // Send successful diagnostics
    return res.json({
      success: true,
      url: testUrl,
      htmlContent: {
        size: htmlContent.length,
        preview: htmlContent.substring(0, 100) + '...'
      },
      extractedText: {
        size: extractedText.length,
        preview: extractedText.substring(0, 100) + '...'
      },
      images: {
        count: images.length,
        urls: images.slice(0, 3)
      },
      routes: {
        postUrl: '/api/slack/enviar-noticia',
        testFlowUrl: '/api/slack/test-flow'
      },
      slackIntegration: 'enabled'
    })
  } catch (error) {
    console.error('Error in debug-enviar-noticia:', error)
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
      url: testUrl
    })
  }
})

// Fix the test-flow route with proper error handling:

slackRoutes.get('/test-flow', async (req, res) => {
  const testUrl = req.query.url || 'https://www.pagina12.com.ar/828737-cristina-kirchner-advirtio-la-inminencia-de-un-default-y-lla'
  
  try {
    // Test the entire flow sequentially
    
    // 1. Fetch content
    const htmlContent = await fetchContent(testUrl)
    
    if (!htmlContent) {
      return res.json({
        success: false,
        error: 'Failed to fetch HTML content',
        step: 'fetchContent'
      })
    }
    
    // 2. Extract text
    const extractedText = extractText(htmlContent)
    
    // 3. Generate metadata (simple test)
    const metadata = {
      title: 'Test Article',
      volanta: 'Test Overline',
      bajada: 'Test excerpt for the article to verify functionality.'
    }
    
    // 4. Test Airtable connection
    const existingRecords = await base('Slack Noticias')
      .select({
        maxRecords: 1
      })
      .firstPage()
    
    return res.json({
      success: true,
      htmlLength: htmlContent.length,
      textLength: extractedText.length,
      airtableConnected: true,
      recordsFound: existingRecords.length,
      metadata
    })
  } catch (error) {
    let htmlContent, extractedText;
    
    // Still provide partial results if we have them
    try {
      htmlContent = await fetchContent(testUrl);
      extractedText = htmlContent ? extractText(htmlContent) : '';
    } catch (e) {
      htmlContent = '';
      extractedText = '';
    }
    
    return res.json({
      success: false,
      htmlLength: htmlContent ? htmlContent.length : 0, 
      textLength: extractedText ? extractedText.length : 0,
      airtableConnected: false,
      airtableError: error.message,
      metadata: {
        title: 'Test Article',
        volanta: 'Test Overline',
        bajada: 'Test excerpt for the article to verify functionality.'
      }
    });
  }
})

export default slackRoutes
