import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

export const config = { maxDuration: 300 }

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '../..')

// HIGH PRIORITY sections — local and regional news
const SECTIONS = [
  'primera-plana',
  'instituciones',
  'local',
  'local-facebook',
  'huanguelen',
  'pueblos-alemanes',
  'la-sexta',
]

function fetchSection(section) {
  return new Promise((resolve) => {
    const child = spawn(
      'node',
      [
        path.join(projectRoot, 'fetch-to-airtable.js'),
        section,
        '--limit',
        '10',
      ],
      { cwd: projectRoot, env: { ...process.env, FORCE_COLOR: '0' } },
    )
    child.on('close', (code) => {
      console.log(`[cron/high] ${section} exited with code ${code}`)
      resolve(code)
    })
    child.on('error', (err) => {
      console.error(`[cron/high] ${section} error:`, err.message)
      resolve()
    })
  })
}

export default async function handler(req, res) {
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const startedAt = new Date().toISOString()
  const results = []

  for (const section of SECTIONS) {
    console.log(`[cron/high] fetching ${section}...`)
    const code = await fetchSection(section)
    results.push({ section, code })
  }

  res.json({ ok: true, sections: SECTIONS, startedAt, results })
}
