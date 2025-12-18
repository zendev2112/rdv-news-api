import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '../..')

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN

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
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const { section, limit = 10 } = req.body

    if (!section) {
      return res.status(400).json({ error: 'Section is required' })
    }

    console.log(`📥 Fetch request: section=${section}, limit=${limit}`)

    // Set up streaming response
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    const scriptPath = path.join(projectRoot, 'fetch-to-airtable.js')

    // Use spawn for streaming output
    const childProcess = spawn(
      'node',
      [scriptPath, section, '--limit', limit.toString()],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          FORCE_COLOR: '0', // Disable colors for clean logs
        },
      }
    )

    let hasError = false
    let stdout = ''
    let stderr = ''

    // Stream stdout in real-time
    childProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n')
      lines.forEach((line) => {
        if (line.trim()) {
          stdout += line + '\n'
          res.write(
            `data: ${JSON.stringify({ type: 'log', message: line })}\n\n`
          )
        }
      })
    })

    // Stream stderr in real-time
    childProcess.stderr.on('data', (data) => {
      const lines = data.toString().split('\n')
      lines.forEach((line) => {
        if (line.trim()) {
          stderr += line + '\n'
          res.write(
            `data: ${JSON.stringify({ type: 'error', message: line })}\n\n`
          )
        }
      })
      hasError = true
    })

    // Handle completion
    childProcess.on('close', (code) => {
      console.log(`Process exited with code ${code}`)

      const result = {
        type: 'complete',
        success: code === 0 && !hasError,
        code,
        section,
        limit,
        timestamp: new Date().toISOString(),
      }

      res.write(`data: ${JSON.stringify(result)}\n\n`)
      res.end()
    })

    // Handle errors
    childProcess.on('error', (error) => {
      console.error('Process error:', error)
      res.write(
        `data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`
      )
      res.end()
    })
  } catch (error) {
    console.error('❌ Handler error:', error)

    res.write(
      `data: ${JSON.stringify({
        type: 'error',
        message: error.message,
      })}\n\n`
    )
    res.end()
  }
}

export const config = {
  maxDuration: 300,
}
