import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '../..')

function fetchSection(section, limit) {
  return new Promise((resolve) => {
    const child = spawn(
      'node',
      [
        path.join(projectRoot, 'fetch-to-airtable.js'),
        section,
        '--limit',
        limit.toString(),
      ],
      { cwd: projectRoot, env: { ...process.env, FORCE_COLOR: '0' } },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.on('error', (err) =>
      resolve({ code: -1, stdout, stderr: err.message }),
    )
  })
}

// GET /api/cron/test?section=instituciones&limit=5
export default async function handler(req, res) {
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const section = req.query.section
  const limit = parseInt(req.query.limit) || 5

  if (!section) {
    return res.status(400).json({ error: 'Missing ?section= parameter' })
  }

  console.log(`[cron/test] fetching ${section} with limit ${limit}...`)
  const startedAt = new Date().toISOString()
  const result = await fetchSection(section, limit)

  res.json({
    ok: result.code === 0,
    section,
    limit,
    startedAt,
    exitCode: result.code,
    output: result.stdout.split('\n').filter(Boolean).slice(-20),
    errors: result.stderr.split('\n').filter(Boolean).slice(-10),
  })
}
