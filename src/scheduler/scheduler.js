import cron from 'node-cron'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

dotenv.config()
const execAsync = promisify(exec)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '../../')

console.log('Starting content scheduler...')

// ── Active fetch strategy ─────────────────────────────────────────────
// Only Quiniela, Horóscopo and Efemérides are generated automatically.
// All other sections are disabled — they can still be fetched manually
// via `node fetch-to-airtable.js <section>` or the /api/fetch endpoints.
//   Quiniela:  twice a day
//   Horóscopo: once a day
//   Efemérides: once a day

async function fetchSections(sections, label) {
  console.log(`📥 [${label}] Fetching ${sections.length} sections...`)
  for (const section of sections) {
    try {
      console.log(`  → Fetching ${section}...`)
      await execAsync(`node fetch-to-airtable.js ${section} --limit 10`, {
        cwd: rootDir,
      })
      console.log(`  ✅ ${section} done`)
    } catch (error) {
      console.error(`  ❌ ${section} failed:`, error.stdout || error.message)
    }
  }
  console.log(`📥 [${label}] Complete`)
}

// HORÓSCOPO + EFEMÉRIDES — once a day: 7am Argentina = 10:00 UTC
cron.schedule('0 10 * * *', () =>
  fetchSections(['horoscopo', 'efemerides'], 'DAILY'),
)

// QUINIELA — twice a day: 15:30 and 21:30 Argentina = 18:30 and 00:30 UTC
cron.schedule('30 18 * * *', () => fetchSections(['quiniela'], 'QUINIELA midday'))
cron.schedule('30 0 * * *', () => fetchSections(['quiniela'], 'QUINIELA evening'))

// Check Airtable connection — once a day at 7am Argentina = 10:00 UTC
cron.schedule('0 10 * * *', async () => {
  try {
    console.log('Running scheduled Airtable connection check')
    await execAsync('npm run check-airtable', { cwd: rootDir })
    console.log('Airtable connection check completed')
  } catch (error) {
    console.error(
      'Airtable connection check failed:',
      error.stdout || error.message,
    )
  }
})

console.log('Scheduler initialized — automatic generation limited to:')
console.log('  Quiniela (2x/day), Horóscopo (1x/day), Efemérides (1x/day)')
console.log('  All other sections are disabled (manual fetch only).')
