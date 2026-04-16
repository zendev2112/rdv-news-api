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

// ── Tiered fetch strategy ─────────────────────────────────────────────
// HIGH: Local/regional — twice a day (8am and 6pm Argentina time, UTC-3)
// MEDIUM: National news — once a day (noon)
// LOW: Evergreen/international — every 3 days (Monday, Wednesday, Friday at 10am)

const HIGH_PRIORITY = [
  'primera-plana',
  'instituciones',
  'local',
  'local-facebook',
  'huanguelen',
  'pueblos-alemanes',
  'la-sexta',
]

const MEDIUM_PRIORITY = [
  'actualidad',
  'politica',
  'economia',
  'deportes',
  'agro',
]

const LOW_PRIORITY = [
  'mundo',
  'lifestyle',
  'cultura',
  'turismo',
  'tecnologia',
  'cine-series',
  'espectaculos',
  'recetas',
  'historia-literatura',
]

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

// HIGH PRIORITY — twice a day: 6am and 6pm (Argentina UTC-3 = 9:00 and 21:00 UTC)
cron.schedule('0 9 * * *', () => fetchSections(HIGH_PRIORITY, 'HIGH morning'))
cron.schedule('0 21 * * *', () => fetchSections(HIGH_PRIORITY, 'HIGH evening'))

// MEDIUM PRIORITY — once a day: 5am Argentina = 8:00 UTC
cron.schedule('0 8 * * *', () => fetchSections(MEDIUM_PRIORITY, 'MEDIUM'))

// LOW PRIORITY — every 2-3 days: Monday, Wednesday, Friday at 10am Argentina = 13:00 UTC
cron.schedule('0 13 * * 1,3,5', () => fetchSections(LOW_PRIORITY, 'LOW'))

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

console.log('Scheduler initialized with tiered fetch strategy:')
console.log(`  HIGH (2x/day):  ${HIGH_PRIORITY.join(', ')}`)
console.log(`  MEDIUM (1x/day): ${MEDIUM_PRIORITY.join(', ')}`)
console.log(`  LOW (Mon/Wed/Fri): ${LOW_PRIORITY.join(', ')}`)
