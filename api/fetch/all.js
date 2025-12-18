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
    const { limit = 10 } = req.body

    console.log(`📥 Fetch ALL sections request: limit=${limit}`)

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    const scriptPath = path.join(projectRoot, 'fetch-to-airtable.js')

    const childProcess = spawn(
      'node',
      [scriptPath, '--all', '--limit', limit.toString()],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          FORCE_COLOR: '0',
        },
      }
    )

    let hasError = false
    let stdout = ''
    let stderr = ''

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

    childProcess.on('close', (code) => {
      console.log(`Process exited with code ${code}`)

      const result = {
        type: 'complete',
        success: code === 0 && !hasError,
        code,
        sections: 'all',
        limit,
        timestamp: new Date().toISOString(),
      }

      res.write(`data: ${JSON.stringify(result)}\n\n`)
      res.end()
    })

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
