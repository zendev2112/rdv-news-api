// filepath: /home/zen/Documents/RDV-NEWS-API/src/scheduler/jobs.js
const cron = require('node-cron')
const config = require('../config')
const { fetchFeedData } = require('../services/fetcher')
const { processBatch } = require('../processors/articleProcessor')
const airtableService = require('../services/airtable')
const logger = require('../utils/logger')

// Store processed URLs to avoid duplicates
const processedUrls = new Set()

/**
 * Fetches and processes items from the RSS feed
 */
async function fetchAndProcessFeed() {
  try {
    logger.info('Starting feed processing')

    // Fetch feed data
    const feedData = await fetchFeedData(config.sources.rss.feedUrl)

    if (!feedData || !feedData.items || !Array.isArray(feedData.items)) {
      logger.warn('No valid items in feed data')
      return
    }

    logger.info(`Fetched ${feedData.items.length} items from feed`)

    // Filter out already processed items
    const newItems = feedData.items.filter(
      (item) => !processedUrls.has(item.url)
    )

    if (newItems.length === 0) {
      logger.info('No new items to process')
      return
    }

    logger.info(`Found ${newItems.length} new items to process`)

    // Process a batch of up to 5 items
    const batch = newItems.slice(0, 5)
    logger.info(`Processing batch of ${batch.length} items`)

    const processedBatch = await processBatch(batch)

    if (processedBatch.length > 0) {
      // Insert into Airtable
      await airtableService.insertRecords(processedBatch)

      // Add to processed URLs
      batch.forEach((item) => processedUrls.add(item.url))

      logger.info(`Completed processing batch of ${batch.length} items`)
    } else {
      logger.info('No valid records after processing batch')
    }
  } catch (error) {
    logger.error('Error in fetch and process job:', error)
  }
}

/**
 * Starts the scheduled jobs
 */
function startJobs() {
  logger.info('Starting scheduled jobs')

  // Schedule feed processing
  cron.schedule(config.scheduler.interval, () => {
    logger.info('Running scheduled feed processing')
    fetchAndProcessFeed()
  })

  // Run immediately on startup
  fetchAndProcessFeed()
}

module.exports = {
  fetchAndProcessFeed,
  startJobs,
}
