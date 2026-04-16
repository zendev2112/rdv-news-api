import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '../..')

// MEDIUM PRIORITY sections — national news with daily relevance
const SECTIONS = ['actualidad', 'politica', 'economia', 'deportes', 'agro']

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
      console.log(`[cron/medium] ${section} exited with code ${code}`)
      resolve()
    })
    child.on('error', (err) => {
      console.error(`[cron/medium] ${section} error:`, err.message)
      resolve()
    })
  })
}

export default async function handler(req, res) {
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  res.json({
    ok: true,
    sections: SECTIONS,
    startedAt: new Date().toISOString(),
  })

  for (const section of SECTIONS) {
    console.log(`[cron/medium] fetching ${section}...`)
    await fetchSection(section)
  }
}
