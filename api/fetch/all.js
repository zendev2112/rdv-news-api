import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { fileURLToPath } from 'url'

const execAsync = promisify(exec)
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

    const scriptPath = path.join(projectRoot, 'fetch-to-airtable.js')
    const command = `node "${scriptPath}" --all --limit ${limit}`

    console.log(`Executing: ${command}`)

    const { stdout, stderr } = await execAsync(command, {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
      },
      timeout: 300000, // 5 minutes
    })

    console.log('✅ Fetch all completed')

    return res.status(200).json({
      success: true,
      sections: 'all',
      limit,
      output: stdout,
      errors: stderr || null,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('❌ Fetch error:', error)

    return res.status(500).json({
      success: false,
      error: error.message,
      stderr: error.stderr,
      stdout: error.stdout,
      timestamp: new Date().toISOString(),
    })
  }
}

export const config = {
  maxDuration: 300,
}
