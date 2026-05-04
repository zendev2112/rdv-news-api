import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '../..')

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

  const args = ['src/scripts/process-social-media.js']
  if (mode === 'slack') args.push('Slack Noticias')
  if (limit) args.push(`--limit=${limit}`)

  console.log(`🔄 Process social request: mode=${mode}`)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  sendEvent({ type: 'log', message: `🚀 Starting process:${mode}...` })

  const child = spawn('node', args, {
    cwd: projectRoot,
    env: { ...process.env },
  })

  child.stdout.on('data', (data) => {
    const lines = data
      .toString()
      .split('\n')
      .filter((l) => l.trim())
    for (const line of lines) {
      sendEvent({ type: 'log', message: line })
    }
  })

  child.stderr.on('data', (data) => {
    const lines = data
      .toString()
      .split('\n')
      .filter((l) => l.trim())
    for (const line of lines) {
      sendEvent({ type: 'log', message: line })
    }
  })

  child.on('close', (code) => {
    sendEvent({
      type: 'complete',
      success: code === 0,
      code,
    })
    res.end()
  })

  child.on('error', (err) => {
    sendEvent({ type: 'error', message: `Process error: ${err.message}` })
    res.end()
  })
}
