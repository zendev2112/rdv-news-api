import airtableService from '../airtable.js'
import { startOfDayArtIso } from '../../config/day-sheet.js'

/**
 * How many records were created today (Argentine day) in each table.
 *
 * This is what makes repeated proposal sessions additive: the picker proposes
 * against "quota minus already approved today", so a second click mid-day only
 * asks for what's still missing from the day sheet.
 *
 * Counting failures degrade to 0 (the picker over-proposes rather than dying;
 * the human confirm absorbs it).
 *
 * @param {string[]} feedIds tables to count
 * @returns {Promise<Map<string, number>>} feedId → records created today
 */
export async function countApprovedToday(feedIds = [], date = new Date()) {
  const since = startOfDayArtIso(date)
  const formula = `IS_AFTER(CREATED_TIME(), '${since}')`
  const counts = new Map()

  // Airtable caps at 5 req/s per base — go in small chunks.
  const CHUNK = 4
  for (let i = 0; i < feedIds.length; i += CHUNK) {
    const chunk = feedIds.slice(i, i + CHUNK)
    await Promise.all(
      chunk.map(async (fid) => {
        try {
          const records = await airtableService.fetchRecords(fid, {
            filterByFormula: formula,
            maxRecords: 100,
          })
          counts.set(fid, Array.isArray(records) ? records.length : 0)
        } catch (err) {
          console.error(`approved-today count failed for ${fid}: ${err.message}`)
          counts.set(fid, 0)
        }
      }),
    )
  }
  return counts
}

export default { countApprovedToday }
