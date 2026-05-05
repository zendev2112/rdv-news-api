import { processSocialMediaContent } from '../../src/scripts/process-social-media.js'

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN

export const config = {
  maxDuration: 300,
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // mode: 'social' = all tables, 'slack' = Slack Noticias only
  const { mode = 'social', limit } = req.body

  const tableName = mode === 'slack' ? 'Slack Noticias' : 'Instituciones'

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  sendEvent({ type: 'log', message: `🚀 Starting process:${mode}...` })

  // Intercept console.log so we can stream output to the client
  const origLog = console.log
  const origError = console.error
  console.log = (...args) => {
    const msg = args.join(' ')
    origLog(msg)
    sendEvent({ type: 'log', message: msg })
  }
  console.error = (...args) => {
    const msg = args.join(' ')
    origError(msg)
    sendEvent({ type: 'log', message: msg })
  }

  try {
    const stats = await processSocialMediaContent({
      tableName,
      limit: limit ? parseInt(limit) : 20,
    })
    sendEvent({
      type: 'log',
      message: `✅ Done — processed: ${stats.processed}, success: ${stats.success}, failed: ${stats.failed}`,
    })
    sendEvent({ type: 'complete', success: true, code: 0 })
  } catch (err) {
    sendEvent({ type: 'error', message: `❌ Error: ${err.message}` })
    sendEvent({ type: 'complete', success: false, code: 1 })
  } finally {
    console.log = origLog
    console.error = origError
    res.end()
  }
}
