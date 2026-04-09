import express from 'express'
import Airtable from 'airtable'
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

// --- Background processing ---

async function processUrlArticle(recordId, url, channel) {
  try {
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

    // For URLs: trigger background AI processing (don't await)
    if (inputIsUrl) {
      processUrlArticle(record.id, input, channel_name).catch((err) =>
        logger.error('Background processing failed:', err.message),
      )
    }
  } catch (error) {
    logger.error('Slack add error:', error.message)
    return res.json({
      response_type: 'ephemeral',
      text: `❌ Error: ${error.message}`,
    })
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
 */
router.post('/events', async (req, res) => {
  const body = req.body

  // 1. URL verification challenge (Slack sends this once during setup)
  if (body.type === 'url_verification') {
    return res.json({ challenge: body.challenge })
  }

  // 2. Respond immediately (Slack requires 200 within 3s)
  res.status(200).send()

  // 3. Ignore retries (Slack retries if it didn't get 200 fast enough)
  if (req.headers['x-slack-retry-num']) {
    logger.info('Ignoring Slack retry')
    return
  }

  // 4. Handle events
  const event = body.event
  if (!event) return

  // Only handle file_shared events
  if (event.type !== 'file_shared') return

  try {
    const fileId = event.file_id
    const userId = event.user_id
    const channelId = event.channel_id

    // Fetch file info from Slack API
    const fileInfoRes = await fetch(
      `https://slack.com/api/files.info?file=${fileId}`,
      {
        headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
      },
    )
    const fileInfo = await fileInfoRes.json()

    if (!fileInfo.ok || !fileInfo.file) {
      logger.error('Could not fetch file info from Slack:', fileInfo.error)
      return
    }

    const file = fileInfo.file
    const fileName = file.name || 'untitled'
    const fileType = file.filetype || ''
    const mimeType = file.mimetype || ''

    // Determine content type
    const isImage = mimeType.startsWith('image/')
    const isAudio = mimeType.startsWith('audio/')
    const isVideo = mimeType.startsWith('video/')

    if (!isImage && !isAudio && !isVideo) {
      logger.info(`Ignoring non-media file: ${fileName} (${mimeType})`)
      return
    }

    // Download file from Slack (needs bot token auth)
    const downloadUrl = file.url_private_download || file.url_private
    if (!downloadUrl) {
      logger.error('No download URL for file:', fileId)
      return
    }

    const fileRes = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    })
    if (!fileRes.ok) {
      logger.error(`Failed to download file from Slack: ${fileRes.status}`)
      return
    }

    const fileBuffer = Buffer.from(await fileRes.arrayBuffer())

    // Upload to Airtable as a base64 data URL attachment
    // Airtable accepts attachments with a URL — we use a temporary upload approach
    // For files from Slack, we pass the Slack URL directly (with bot token, Slack URLs are temporary)
    // Better approach: use Airtable's attachment field which accepts URL + filename

    // Build the Airtable record
    const typeLabel = isImage ? '📸 Imagen' : isAudio ? '🎙️ Audio' : '🎬 Video'
    const comment = file.initial_comment?.comment || file.title || fileName

    // Get user info for the title
    let userName = 'Equipo'
    try {
      const userRes = await fetch(
        `https://slack.com/api/users.info?user=${userId}`,
        {
          headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
        },
      )
      const userInfo = await userRes.json()
      if (userInfo.ok) userName = userInfo.user.real_name || userInfo.user.name
    } catch {}

    // Get channel name for notifications
    let channelName = ''
    try {
      const chanRes = await fetch(
        `https://slack.com/api/conversations.info?channel=${channelId}`,
        {
          headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
        },
      )
      const chanInfo = await chanRes.json()
      if (chanInfo.ok) channelName = chanInfo.channel.name
    } catch {}

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

    // Airtable attachment: pass the Slack private URL with auth header won't work,
    // so we use the public permalink if available, or upload via the Airtable API directly
    // Slack's url_private requires auth, but Airtable fetches attachments server-side
    // Solution: use Slack's public share URL or create a temporary signed URL

    // For Airtable attachments, we need a publicly accessible URL.
    // Slack files ARE publicly accessible if the file is shared — check permalink_public
    if (file.public_url_shared || file.permalink_public) {
      const publicUrl = file.permalink_public
        ? `${file.permalink_public.replace(/\?.*$/, '')}?pub_secret=${file.permalink_public.split('pub_secret=')[1] || ''}`
        : null

      if (publicUrl && isImage) {
        recordFields.image = [{ url: publicUrl }]
        recordFields.imgUrl = publicUrl
      }
    }

    // If no public URL available, make the file public first
    if (!recordFields.image && !file.public_url_shared) {
      try {
        const shareRes = await fetch(
          'https://slack.com/api/files.sharedPublicURL',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.SLACK_USER_TOKEN || process.env.SLACK_BOT_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ file: fileId }),
          },
        )
        const shareData = await shareRes.json()

        if (shareData.ok && shareData.file) {
          const pubUrl = shareData.file.permalink_public
          if (pubUrl && isImage) {
            recordFields.image = [{ url: pubUrl }]
            recordFields.imgUrl = pubUrl
          }
        }
      } catch (err) {
        logger.warn('Could not make file public:', err.message)
      }
    }

    const record = await base(TABLE_NAME).create(recordFields)

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

    logger.info(
      `✅ Saved Slack file ${fileName} to Airtable record ${record.id}`,
    )
  } catch (error) {
    logger.error('Error handling Slack file event:', error.message)
  }
})

export default router
