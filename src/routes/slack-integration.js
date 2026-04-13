import express from 'express'
import Airtable from 'airtable'
import { waitUntil } from '@vercel/functions'
import { v2 as cloudinary } from 'cloudinary'
import logger from '../utils/logger.js'
import { generateContent } from '../services/ai-service.js'
import {
  fetchContent,
  extractText,
  extractImagesAsMarkdown,
} from '../services/scraper.js'
import {
  reelaborateArticle,
  reelaborateSocialMedia,
  generateMetadata,
  generateSocialMediaMetadata,
  generateTags,
} from '../prompts/index.js'

const router = express.Router()

// Initialize Airtable
const base = new Airtable({ apiKey: process.env.AIRTABLE_TOKEN }).base(
  process.env.AIRTABLE_BASE_ID,
)

const TABLE_NAME = 'Slack Noticias'

// --- Utility functions ---

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

function extractSourceName(url) {
  try {
    if (!url) return 'Slack'
    const hostname = new URL(url).hostname
    let domain = hostname
      .replace(/^www\./, '')
      .replace(/^m\./, '')
      .replace(/^mobile\./, '')

    if (domain.includes('facebook.com')) return 'Facebook'
    if (domain.includes('instagram.com')) return 'Instagram'
    if (domain.includes('twitter.com') || domain.includes('x.com'))
      return 'Twitter'
    if (domain.includes('youtube.com') || domain.includes('youtu.be'))
      return 'YouTube'
    if (domain.includes('tiktok.com')) return 'TikTok'

    domain = domain.replace(
      /\.(com|co|net|org|info|ar|mx|es|cl|pe|br|uy|py|bo|ec|ve|us|io|tv|app|web|digital|news|online|press|media|blog|site)(\.[a-z]{2,3})?$/,
      '',
    )
    const mapping = {
      lanacion: 'La Nación',
      pagina12: 'Página 12',
      infobae: 'Infobae',
      clarin: 'Clarín',
      tn: 'Todo Noticias',
      eldestape: 'El Destape',
      ambito: 'Ámbito',
      cronista: 'El Cronista',
      telam: 'Télam',
      tiempoar: 'Tiempo Argentino',
      ole: 'Olé',
    }
    const parts = domain.split('.')
    const key = parts[0]
    if (mapping[key]) return mapping[key]
    return key.charAt(0).toUpperCase() + key.slice(1)
  } catch {
    return 'Slack'
  }
}

function isUrl(text) {
  try {
    const url = new URL(text.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function stripMarkdown(text) {
  if (!text) return ''
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/ {2,}/g, ' ')
    .trim()
}

async function sendSlackMessage(channel, text, attachment = null) {
  if (!process.env.SLACK_BOT_TOKEN) return
  const payload = {
    channel: channel.startsWith('#') ? channel : `#${channel}`,
    text,
  }
  if (attachment) payload.attachments = [attachment]
  try {
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    logger.error('Error sending Slack message:', error.message)
  }
}

// Helper to run task with timeout
function withTimeout(promise, timeoutMs = 25000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Task timeout after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ])
}

// Download a file from Slack using bot token authentication
async function downloadSlackFile(file) {
  const downloadUrl = file.url_private_download || file.url_private
  if (!downloadUrl) throw new Error('No download URL available for Slack file')

  const res = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  })
  if (!res.ok) throw new Error(`Failed to download Slack file: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

// Upload a Slack file buffer to Cloudinary and return the URL
async function uploadSlackFileToCloudinary(
  buffer,
  fileName,
  resourceType = 'image',
) {
  const timestamp = Date.now()
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').split('.')[0]
  const publicId = `slack-uploads/${timestamp}-${safeName}`

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        resource_type: resourceType,
        use_filename: true,
        unique_filename: true,
      },
      (error, result) => {
        if (error) reject(error)
        else resolve(result.secure_url)
      },
    )
    stream.end(buffer)
  })
}

// --- Background processing ---

async function processUrlArticle(recordId, url, channel) {
  try {
    // Guard against double-processing (both waitUntil and self-POST may fire)
    const existing = await base(TABLE_NAME).find(recordId)
    if (
      existing.fields.article &&
      existing.fields.article !== 'Procesando...'
    ) {
      logger.info(`Record ${recordId} already processed, skipping`)
      return
    }

    const isSocial = isSocialMediaUrl(url)
    const sourceName = extractSourceName(url)

    // Fetch and extract content
    const html = await fetchContent(url)
    const { text: extractedText } = extractText(html)
    const { images, markdown: imageMarkdown } = extractImagesAsMarkdown(html)

    if (!extractedText || extractedText.length < 50) {
      // Not enough content to process — keep the draft as-is
      await sendSlackMessage(
        channel,
        `⚠️ Could not extract enough content from ${url}. Record saved as draft.`,
      )
      return
    }

    // Generate content using the unified prompts
    let articleText, metadata, tags

    if (isSocial) {
      const item = { url, title: '', content_text: extractedText }
      const articleResult = await generateContent(
        reelaborateSocialMedia(extractedText, item, sourceName),
      )
      articleText = articleResult.text

      const metaResult = await generateContent(
        generateSocialMediaMetadata(extractedText),
      )
      const metaMatch = metaResult.text.match(/\{[\s\S]*\}/)
      metadata = metaMatch
        ? JSON.parse(metaMatch[0])
        : {
            title: `Publicación de ${sourceName}`,
            bajada: '',
            volanta: 'Redes Sociales',
          }

      const tagsResult = await generateContent(
        generateTags(extractedText, metadata),
      )
      const tagsMatch = tagsResult.text.match(/\[[\s\S]*\]/)
      tags = tagsMatch ? JSON.parse(tagsMatch[0]).join(', ') : 'Redes Sociales'
    } else {
      const textWithImages = imageMarkdown
        ? `${extractedText}\n\n${imageMarkdown}`
        : extractedText
      const articleResult = await generateContent(
        reelaborateArticle(textWithImages),
      )
      articleText = articleResult.text

      const metaResult = await generateContent(generateMetadata(extractedText))
      const metaMatch = metaResult.text.match(/\{[\s\S]*\}/)
      metadata = metaMatch
        ? JSON.parse(metaMatch[0])
        : { title: 'Artículo procesado', bajada: '', volanta: 'Noticias' }

      const tagsResult = await generateContent(
        generateTags(extractedText, metadata),
      )
      const tagsMatch = tagsResult.text.match(/\[[\s\S]*\]/)
      tags = tagsMatch
        ? JSON.parse(tagsMatch[0]).join(', ')
        : 'Noticias, Actualidad'
    }

    // Build update fields
    const updateFields = {
      title: stripMarkdown(metadata.title || ''),
      overline: stripMarkdown(metadata.volanta || ''),
      excerpt: stripMarkdown(metadata.bajada || ''),
      article: articleText,
      tags,
      imgUrl: images.length > 0 ? images[0] : '',
      'article-images': images.slice(1).join(', '),
      status: 'draft',
    }

    // Set social media type field
    const socialType = getSocialMediaType(url)
    if (socialType) updateFields[socialType] = url

    // Image attachments
    if (images.length > 0) {
      updateFields.image = images.slice(0, 3).map((imgUrl) => ({ url: imgUrl }))
    }

    await base(TABLE_NAME).update(recordId, updateFields)

    await sendSlackMessage(channel, null, {
      text: `✅ Artículo procesado`,
      color: 'good',
      fields: [
        {
          title: 'Título',
          value: stripMarkdown(metadata.title) || 'Sin título',
          short: false,
        },
        { title: 'Fuente', value: sourceName, short: true },
      ],
    })
  } catch (error) {
    logger.error(`Error processing Slack article ${url}:`, error.message)
    await sendSlackMessage(
      channel,
      `❌ Error procesando artículo: ${error.message}`,
    )
  }
}

// --- Routes ---

/**
 * Slack slash command handler
 * POST /api/slack/add
 *
 * Slack sends: text (the message after /command), user_name, channel_name
 * Accepts: URLs (regular or social media) and plain text
 */
router.post('/add', async (req, res) => {
  try {
    const { text, user_name, channel_name } = req.body

    if (!text || !text.trim()) {
      return res.json({
        response_type: 'ephemeral',
        text: '❌ Enviá una URL o texto. Ejemplo: `/noticia https://infobae.com/...`',
      })
    }

    const input = text.trim()
    const inputIsUrl = isUrl(input)
    const sourceName = inputIsUrl ? extractSourceName(input) : 'Slack'

    // Create record immediately (Slack needs a response in 3s)
    const recordFields = {
      url: inputIsUrl ? input : '',
      source: sourceName,
      title: inputIsUrl ? `Artículo de ${sourceName}` : input.substring(0, 70),
      article: inputIsUrl ? 'Procesando...' : input,
      status: 'draft',
      tags: 'Slack Import',
      overline: '',
      excerpt: '',
      imgUrl: '',
      'ig-post': '',
      'fb-post': '',
      'tw-post': '',
      'yt-video': '',
      'article-images': '',
    }

    // For social media URLs, set the type field right away
    if (inputIsUrl) {
      const socialType = getSocialMediaType(input)
      if (socialType) recordFields[socialType] = input
    }

    const record = await base(TABLE_NAME).create(recordFields)

    // For URLs: trigger standalone serverless function at api/slack/process.js
    // MUST await so the HTTP request is sent before Vercel kills this function
    if (inputIsUrl) {
      try {
        await fetch('https://rdv-news-api.vercel.app/api/slack/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recordId: record.id,
            url: input,
            channel: channel_name,
          }),
        })
      } catch (err) {
        logger.error('Failed to trigger process:', err.message)
      }
    }

    // Respond to Slack immediately
    res.json({
      response_type: 'in_channel',
      text: inputIsUrl
        ? `🔄 Procesando artículo de ${sourceName}...`
        : `📝 Texto guardado en Airtable por ${user_name}`,
      attachments: [
        {
          color: inputIsUrl ? 'warning' : 'good',
          fields: [
            {
              title: inputIsUrl ? 'URL' : 'Texto',
              value: input.substring(0, 200),
              short: false,
            },
            { title: 'Por', value: user_name, short: true },
          ],
        },
      ],
    })
  } catch (error) {
    logger.error('Slack add error:', error.message)
    return res.json({
      response_type: 'ephemeral',
      text: `❌ Error: ${error.message}`,
    })
  }
})

/**
 * Background processing endpoint — called internally by /add
 * POST /api/slack/process
 * Runs as a separate Vercel function invocation so it isn't killed when /add responds
 */
router.post('/process', async (req, res) => {
  // Respond immediately so the caller isn't blocked
  res.status(202).send()

  const { recordId, url, channel } = req.body
  if (!recordId || !url) return

  try {
    await processUrlArticle(recordId, url, channel)
  } catch (error) {
    logger.error('Error in /process:', error.message)
  }
})

// Keep the old endpoint for backwards compatibility
router.post('/simple-add', async (req, res) => {
  try {
    const { text, user_name, channel_name } = req.body

    res.json({
      response_type: 'in_channel',
      text: `📝 Adding URL to Airtable...`,
    })

    const record = await base(TABLE_NAME).create({
      url: text.trim(),
      source: 'Manual',
      title: `Article from ${user_name}`,
      article: 'Pending processing',
      status: 'draft',
      tags: 'Manual Entry',
    })

    await sendSlackMessage(
      channel_name,
      `✅ URL saved to Airtable! Record ID: ${record.id}`,
    )
  } catch (error) {
    logger.error('Slack simple-add error:', error.message)
    await sendSlackMessage(req.body.channel_name, `❌ Error: ${error.message}`)
  }
})

// --- Slack Events API ---

/**
 * Slack Events API handler
 * POST /api/slack/events
 *
 * Handles:
 * - url_verification (Slack challenge on setup)
 * - file_shared events (images, audio, video uploaded to a channel)
 * - message events with files (alternative Slack event format)
 */
router.post('/events', async (req, res) => {
  const body = req.body

  // 1. URL verification challenge (Slack sends this once during setup)
  if (body.type === 'url_verification') {
    return res.json({ challenge: body.challenge })
  }

  // 2. Ignore Slack retries
  if (req.headers['x-slack-retry-num']) {
    return res.status(200).send()
  }

  const event = body.event
  if (!event) {
    logger.warn('Slack event received with no event payload:', body.type)
    return res.status(200).send()
  }

  logger.info(
    `Slack event received: type=${event.type}, subtype=${event.subtype || 'none'}`,
  )

  // 3. Handle file_shared events
  if (event.type === 'file_shared') {
    waitUntil(
      processFileSharedEvent(event.file_id, event.user_id, event.channel_id),
    )
    return res.status(200).send()
  }

  // 4. Handle message events with files (alternative event format)
  if (event.type === 'message' && event.files && event.files.length > 0) {
    // Skip bot messages to avoid loops
    if (event.bot_id || event.subtype === 'bot_message') {
      return res.status(200).send()
    }
    waitUntil(processMessageWithFiles(event))
    return res.status(200).send()
  }

  // 5. Unknown event type — accept but ignore
  logger.info(`Ignoring Slack event type: ${event.type}`)
  return res.status(200).send()
})

// --- File processing helpers ---

async function fetchSlackFileInfo(fileId) {
  const res = await fetch(`https://slack.com/api/files.info?file=${fileId}`, {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  })
  const data = await res.json()
  if (!data.ok || !data.file) {
    throw new Error(`Slack files.info failed: ${data.error || 'no file'}`)
  }
  return data.file
}

async function getSlackUserName(userId) {
  try {
    const res = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    })
    const data = await res.json()
    if (data.ok) return data.user.real_name || data.user.name
  } catch {}
  return 'Equipo'
}

async function getSlackChannelName(channelId) {
  try {
    const res = await fetch(
      `https://slack.com/api/conversations.info?channel=${channelId}`,
      { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } },
    )
    const data = await res.json()
    if (data.ok) return data.channel.name
  } catch {}
  return ''
}

// Download from Slack and upload to Cloudinary for a persistent public URL
async function getCloudinaryUrl(file, fileId) {
  try {
    const buffer = await downloadSlackFile(file)
    const mimeType = file.mimetype || ''
    const resourceType = mimeType.startsWith('video/')
      ? 'video'
      : mimeType.startsWith('audio/')
        ? 'video' // Cloudinary uses 'video' for audio too
        : 'image'
    const url = await uploadSlackFileToCloudinary(
      buffer,
      file.name || 'slack-file',
      resourceType,
    )
    logger.info(`Uploaded Slack file to Cloudinary: ${url}`)
    return url
  } catch (err) {
    logger.warn('Could not upload Slack file to Cloudinary:', err.message)
    return null
  }
}

async function saveFileToAirtable(file, fileId, userId, channelId) {
  const fileName = file.name || 'untitled'
  const mimeType = file.mimetype || ''

  const isImage = mimeType.startsWith('image/')
  const isAudio = mimeType.startsWith('audio/')
  const isVideo = mimeType.startsWith('video/')

  if (!isImage && !isAudio && !isVideo) {
    logger.info(`Ignoring non-media file: ${fileName} (${mimeType})`)
    return
  }

  const typeLabel = isImage ? '📸 Imagen' : isAudio ? '🎙️ Audio' : '🎬 Video'
  const comment = file.initial_comment?.comment || file.title || fileName

  const userName = await getSlackUserName(userId)
  const channelName = await getSlackChannelName(channelId)

  const recordFields = {
    title: `${typeLabel} de ${userName}`,
    article: comment,
    source: 'Slack',
    status: 'draft',
    tags: 'Slack Import',
    overline: '',
    excerpt: '',
    url: '',
    imgUrl: '',
    'article-images': '',
    'ig-post': '',
    'fb-post': '',
    'tw-post': '',
    'yt-video': '',
  }

  // Upload media to Cloudinary for a persistent public URL
  const cloudinaryUrl = await getCloudinaryUrl(file, fileId)
  if (cloudinaryUrl) {
    if (isImage) {
      recordFields.image = [{ url: cloudinaryUrl }]
      recordFields.imgUrl = cloudinaryUrl
    } else if (isAudio) {
      recordFields.url = cloudinaryUrl // Store audio URL in url field
    } else if (isVideo) {
      recordFields.url = cloudinaryUrl // Store video URL in url field
    }
  }

  const record = await base(TABLE_NAME).create(recordFields)
  logger.info(`Saved Slack file ${fileName} to Airtable record ${record.id}`)

  if (channelName) {
    await sendSlackMessage(channelName, null, {
      text: `✅ ${typeLabel} guardado en Airtable`,
      color: 'good',
      fields: [
        { title: 'Archivo', value: fileName, short: true },
        { title: 'Por', value: userName, short: true },
      ],
    })
  }
}

// --- Background event processors (called via waitUntil) ---

async function processFileSharedEvent(fileId, userId, channelId) {
  try {
    logger.info(`Processing file_shared event: fileId=${fileId}`)
    const file = await fetchSlackFileInfo(fileId)
    await saveFileToAirtable(file, fileId, userId, channelId)
  } catch (error) {
    logger.error('Error processing file_shared event:', error.message)
  }
}

async function processMessageWithFiles(event) {
  try {
    const channelId = event.channel
    const userId = event.user
    logger.info(
      `Processing message with ${event.files.length} file(s) from user ${userId}`,
    )

    for (const file of event.files) {
      const fileId = file.id
      // file object from message event may have partial info — fetch full info
      const fullFile = await fetchSlackFileInfo(fileId)
      await saveFileToAirtable(fullFile, fileId, userId, channelId)
    }
  } catch (error) {
    logger.error('Error processing message with files:', error.message)
  }
}

/**
 * Legacy background file processing endpoint — kept as fallback
 * POST /api/slack/events/process
 */
router.post('/events/process', async (req, res) => {
  res.status(202).send()

  const { fileId, userId, channelId } = req.body
  if (!fileId) return

  await processFileSharedEvent(fileId, userId, channelId)
})

export default router
