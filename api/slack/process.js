/**
 * Standalone Vercel serverless function for background article processing.
 * Called by /api/slack/add via self-POST so it runs as a SEPARATE Vercel
 * function invocation with its own 300s timeout.
 *
 * This MUST live outside of src/server.js so Vercel treats it as an
 * independent function — not part of the Express catch-all.
 */

// Vercel function config — builds[].config ignores maxDuration,
// so it must be exported from the function file itself.
export const config = {
  maxDuration: 300,
}

import Airtable from 'airtable'
import { processArticleFromUrl, extractSourceName } from '../../src/services/article-pipeline.js'

const base = new Airtable({ apiKey: process.env.AIRTABLE_TOKEN }).base(
  process.env.AIRTABLE_BASE_ID,
)
const TABLE_NAME = 'Slack Noticias'

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

  try {
    // Guard against double-processing
    const existing = await base(TABLE_NAME).find(recordId)
    const existingArticle = (existing.fields.article || '').trim()
    if (existingArticle && existingArticle !== 'Procesando...') {
      console.log(`Record ${recordId} already processed, skipping`)
      return res.status(200).json({ status: 'already_processed' })
    }

    // Run the shared pipeline
    const fields = await processArticleFromUrl(url)

    if (!fields) {
      await sendSlackMessage(
        channel,
        `⚠️ No se pudo extraer contenido suficiente de ${url}. Registro guardado como borrador.`,
      )
      return res.status(200).json({ status: 'insufficient_content' })
    }

    await base(TABLE_NAME).update(recordId, fields)

    const sourceName = extractSourceName(url)
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

    return res.status(200).json({ status: 'processed' })
  } catch (error) {
    console.error(`Error processing Slack article ${url}:`, error.message)
    await sendSlackMessage(
      channel,
      `❌ Error procesando artículo: ${error.message}`,
    )
    return res.status(500).json({ error: error.message })
  }
}
