import { handlePublishStatusChange } from './statusChangeHandler.js'
import logger from '../utils/logger.js'
import axios from 'axios'
import config from '../config/index.js'

/**
 * Check all tables for newly published articles and upload to Cloudinary
 */
async function checkForNewlyPublished() {
  try {
    logger.info('🔍 Checking for newly published articles...')

    const baseId = config.airtable?.baseId || process.env.AIRTABLE_BASE_ID
    const apiToken =
      config.airtable?.personalAccessToken || process.env.AIRTABLE_TOKEN

    // Your table names and their section IDs
    const tables = [
      { name: 'Primera Plana', sectionId: 'primera-plana' },
      { name: 'Politica', sectionId: 'politica' },
      { name: 'Deportes', sectionId: 'deportes' },
      { name: 'Economia', sectionId: 'economia' },
      { name: 'La Sexta', sectionId: 'la-sexta' },
      { name: 'Instituciones', sectionId: 'instituciones'},
      // Add more tables as needed
    ]

    for (const table of tables) {
      const airtableApiUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
        table.name
      )}`

      try {
        // Find published articles that still have Airtable URLs
        const response = await axios.get(airtableApiUrl, {
          headers: {
            Authorization: `Bearer ${apiToken}`,
          },
          params: {
            filterByFormula: `AND({status} = 'published', FIND('airtableusercontent.com', {imgUrl}) > 0)`,
            maxRecords: 20,
          },
        })

        const records = response.data.records

        if (records.length > 0) {
          logger.info(
            `📋 Found ${records.length} articles needing Cloudinary upload in ${table.name}`
          )

          for (const record of records) {
            await handlePublishStatusChange(
              record.id,
              table.name,
              table.sectionId
            )
            // Small delay to avoid rate limits
            await new Promise((resolve) => setTimeout(resolve, 1000))
          }
        }
      } catch (tableError) {
        logger.error(
          `❌ Error checking table ${table.name}:`,
          tableError.message
        )
      }
    }
  } catch (error) {
    logger.error('❌ Error in auto publisher:', error.message)
  }
}

// Start the polling service
export function startAutoPublisher() {
  logger.info('🚀 Starting auto publisher - checking every 2 minutes')

  // Run immediately
  checkForNewlyPublished()

  // Then run every 2 minutes
  setInterval(checkForNewlyPublished, 2 * 60 * 1000)
}

export default {
  startAutoPublisher,
  checkForNewlyPublished,
}
