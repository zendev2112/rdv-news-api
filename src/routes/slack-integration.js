import express from 'express'
import Airtable from 'airtable'
import { waitUntil } from '@vercel/functions'
import { v2 as cloudinary } from 'cloudinary'
import logger from '../utils/logger.js'
import {
  processArticleFromUrl,
  isSocialMediaUrl,
  getSocialMediaType,
  extractSourceName,
  stripMarkdown,
} from '../services/article-pipeline.js'

const router = express.Router()

// Initialize Airtable
const base = new Airtable({ apiKey: process.env.AIRTABLE_TOKEN }).base(
  process.env.AIRTABLE_BASE_ID,
)

const TABLE_NAME = 'Slack Noticias'

// Channel(s) where plain-text messages are auto-processed into articles.
// Set SLACK_NEWS_CHANNELS as a comma-separated list of channel IDs or names.
// Default: only #redaccion. Use '*' to allow all channels.
const NEWS_CHANNELS = (process.env.SLACK_NEWS_CHANNELS || 'redaccion')
  .split(',')
  .map((c) => c.trim().replace(/^#/, ''))

// --- Utility functions (Slack-specific only) ---

function isUrl(text) {
  try {
    const url = new URL(text.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
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
    // Guard against double-processing
    const existing = await base(TABLE_NAME).find(recordId)
    if (
      existing.fields.article &&
      existing.fields.article !== 'Procesando...'
    ) {
      logger.info(`Record ${recordId} already processed, skipping`)
      return
    }

    const sourceName = extractSourceName(url)

    // Social media URLs can't be scraped — just save the URL to the right field
    if (isSocialMediaUrl(url)) {
      const socialType = getSocialMediaType(url)
      const updateFields = {}
      if (socialType) updateFields[socialType] = url
      updateFields.title = `Publicación de ${sourceName}`
      updateFields.source = sourceName
      updateFields.article = `Enlace a publicación de ${sourceName}: ${url}`
      updateFields.status = 'draft'

      await base(TABLE_NAME).update(recordId, updateFields)
      await sendSlackMessage(channel, null, {
        text: `✅ Enlace de ${sourceName} guardado`,
        color: 'good',
        fields: [
          { title: 'Fuente', value: sourceName, short: true },
          { title: 'URL', value: url, short: false },
        ],
      })
      return
    }

    // Regular article: run the shared pipeline
    const fields = await processArticleFromUrl(url)

    if (!fields) {
      await sendSlackMessage(
        channel,
        `⚠️ No se pudo extraer contenido suficiente de ${url}. Registro guardado como borrador.`,
      )
      return
    }

    await base(TABLE_NAME).update(recordId, fields)

    await sendSlackMessage(channel, null, {
      text: `✅ Artículo procesado`,
      color: 'good',
      fields: [
        {
          title: 'Título',
          value: fields.title || 'Sin título',
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

async function processTextArticle(recordId, text, channel) {
  try {
    // Guard against double-processing
    const existing = await base(TABLE_NAME).find(recordId)
    if (
      existing.fields.article &&
      existing.fields.article !== 'Procesando...'
    ) {
      logger.info(`Record ${recordId} already processed, skipping`)
      return
    }

    // Run the shared pipeline with pre-extracted text (no scraping needed)
    const fields = await processArticleFromUrl('', {
      extractedText: text,
      sourceName: 'Slack',
    })

    if (!fields) {
      // Text too short for AI — save the raw text back as-is
      await base(TABLE_NAME).update(recordId, {
        article: text,
        title: text.substring(0, 70),
      })
      await sendSlackMessage(
        channel,
        '📝 Texto guardado (muy corto para generar artículo)',
      )
      return
    }

    // Don't overwrite with empty url
    delete fields.url
    fields.source = 'Slack'

    await base(TABLE_NAME).update(recordId, fields)

    await sendSlackMessage(channel, null, {
      text: '✅ Artículo generado desde texto',
      color: 'good',
      fields: [
        {
          title: 'Título',
          value: fields.title || 'Sin título',
          short: false,
        },
      ],
    })
  } catch (error) {
    logger.error(`Error processing text article: ${error.message}`)
    // On failure, restore the original text so it's not lost
    try {
      await base(TABLE_NAME).update(recordId, { article: text })
    } catch {}
    await sendSlackMessage(
      channel,
      `❌ Error generando artículo: ${error.message}`,
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
      title: inputIsUrl ? `Artículo de ${sourceName}` : 'Generando artículo...',
      article: 'Procesando...',
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

    // Respond to Slack FIRST (must happen within 3s)
    res.json({
      response_type: 'in_channel',
      text: inputIsUrl
        ? `🔄 Procesando artículo de ${sourceName}...`
        : `� Generando artículo desde texto de ${user_name}...`,
      attachments: [
        {
          color: 'warning',
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

    // AFTER responding to Slack, trigger background processing.
    if (inputIsUrl) {
      // URL: fire-and-forget to the separate Vercel function (own 300s timeout)
      const processPayload = {
        recordId: record.id,
        url: input,
        channel: channel_name,
      }
      fetch('https://rdv-news-api.vercel.app/api/slack/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(processPayload),
      }).catch((err) => logger.error('Failed to trigger process:', err.message))
    } else {
      // Text: generate article via AI in the background
      waitUntil(processTextArticle(record.id, input, channel_name))
    }
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

  logger.info(
    `/events hit: type=${body.type}, event_type=${body.event?.type || 'none'}`,
  )

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
    `Slack event: type=${event.type}, subtype=${event.subtype || 'none'}, channel=${event.channel || 'none'}, bot_id=${event.bot_id || 'none'}, text=${(event.text || '').substring(0, 50)}`,
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

  // 5. Handle plain text messages (no files, no slash command)
  //    Only process in designated news channel(s) to avoid capturing all chat
  if (
    event.type === 'message' &&
    !event.subtype &&
    !event.bot_id &&
    event.text &&
    event.text.trim().length > 0
  ) {
    // Check channel filter — resolve channel name first
    const channelName = await getSlackChannelName(event.channel)
    logger.info(
      `Channel check: id=${event.channel}, name="${channelName}", allowed=${NEWS_CHANNELS}`,
    )
    const allowed =
      NEWS_CHANNELS.includes('*') || NEWS_CHANNELS.includes(channelName)
    if (!allowed) {
      logger.info(
        `Message ignored: channel "${channelName}" not in NEWS_CHANNELS [${NEWS_CHANNELS}]`,
      )
      return res.status(200).send()
    }
    waitUntil(processPlainTextMessage(event))
    return res.status(200).send()
  }

  // 6. Unknown event type — accept but ignore
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

async function processPlainTextMessage(event) {
  try {
    // Slack wraps URLs in <url|label> or <url> format — extract the raw URL
    let text = event.text
      .trim()
      .replace(/<(https?:\/\/[^|>]+)(?:\|[^>]*)?>/g, '$1')
    const channelId = event.channel
    const userId = event.user

    const userName = await getSlackUserName(userId)
    const channelName = await getSlackChannelName(channelId)

    logger.info(
      `Processing plain text message from ${userName} (${text.length} chars)`,
    )

    // Check if it's a URL — route through the URL pipeline
    const inputIsUrl = isUrl(text)
    const sourceName = inputIsUrl ? extractSourceName(text) : 'Slack'

    const recordFields = {
      url: inputIsUrl ? text : '',
      source: sourceName,
      title: inputIsUrl ? `Artículo de ${sourceName}` : 'Generando artículo...',
      article: 'Procesando...',
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

    if (inputIsUrl) {
      const socialType = getSocialMediaType(text)
      if (socialType) recordFields[socialType] = text
    }

    const record = await base(TABLE_NAME).create(recordFields)

    if (channelName) {
      await sendSlackMessage(channelName, null, {
        text: inputIsUrl
          ? `🔄 Procesando artículo de ${sourceName}...`
          : `🔄 Generando artículo desde texto de ${userName}...`,
        color: 'warning',
        fields: [
          {
            title: inputIsUrl ? 'URL' : 'Texto',
            value: text.substring(0, 200),
            short: false,
          },
          { title: 'Por', value: userName, short: true },
        ],
      })
    }

    // Process URL or text
    if (inputIsUrl) {
      await processUrlArticle(record.id, text, channelName)
    } else {
      await processTextArticle(record.id, text, channelName)
    }
  } catch (error) {
    logger.error('Error processing plain text message:', error.message)
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
