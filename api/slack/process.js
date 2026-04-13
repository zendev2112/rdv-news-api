/**
 * Standalone Vercel serverless function for background article processing.
 * Called by /api/slack/add via self-POST so it runs as a SEPARATE Vercel
 * function invocation with its own 300s timeout.
 *
 * This MUST live outside of src/server.js so Vercel treats it as an
 * independent function — not part of the Express catch-all.
 */
import { waitUntil } from '@vercel/functions'
import Airtable from 'airtable'
import { generateContent } from '../../src/services/ai-service.js'
import {
  fetchContent,
  extractText,
  extractImagesAsMarkdown,
} from '../../src/services/scraper.js'
import {
  reelaborateArticle,
  reelaborateSocialMedia,
  generateMetadata,
  generateSocialMediaMetadata,
  generateTags,
} from '../../src/prompts/index.js'

const base = new Airtable({ apiKey: process.env.AIRTABLE_TOKEN }).base(
  process.env.AIRTABLE_BASE_ID,
)
const TABLE_NAME = 'Slack Noticias'

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
    const key = domain.split('.')[0]
    if (mapping[key]) return mapping[key]
    return key.charAt(0).toUpperCase() + key.slice(1)
  } catch {
    return 'Slack'
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
  } catch {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { recordId, url, channel } = req.body
  if (!recordId || !url) {
    return res.status(400).json({ error: 'Missing recordId or url' })
  }

  // Respond 202 immediately so the caller (/add) gets a response fast.
  // waitUntil keeps this function alive for up to 300s to finish processing.
  res.status(202).json({ status: 'processing' })

  waitUntil(processArticle(recordId, url, channel))
}

async function processArticle(recordId, url, channel) {
  try {
    // Guard against double-processing
    const existing = await base(TABLE_NAME).find(recordId)
    if (
      existing.fields.article &&
      existing.fields.article !== 'Procesando...'
    ) {
      console.log(`Record ${recordId} already processed, skipping`)
      return
    }

    const isSocial = isSocialMediaUrl(url)
    const sourceName = extractSourceName(url)

    const html = await fetchContent(url)
    const { text: extractedText } = extractText(html)
    const { images, markdown: imageMarkdown } = extractImagesAsMarkdown(html)

    if (!extractedText || extractedText.length < 50) {
      await sendSlackMessage(
        channel,
        `⚠️ No se pudo extraer contenido suficiente de ${url}. Registro guardado como borrador.`,
      )
      return
    }

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

    const socialType = getSocialMediaType(url)
    if (socialType) updateFields[socialType] = url

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
    console.error(`Error processing Slack article ${url}:`, error.message)
    await sendSlackMessage(
      channel,
      `❌ Error procesando artículo: ${error.message}`,
    )
  }
}
