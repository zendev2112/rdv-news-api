const axios = require('axios')
const logger = require('../utils/logger')

/**
 * Fetches HTML content from a URL
 * @param {string} url - URL to fetch content from
 * @param {number} timeout - Request timeout in milliseconds
 * @returns {Promise<string|null>} - HTML content or null if failed
 */
async function fetchContent(url, timeout = 10000) {
  try {
    const response = await axios.get(url, { timeout })
    return response.data
  } catch (error) {
    logger.error(`Error fetching content from ${url}:`, error)
    return null
  }
}

/**
 * Fetches RSS feed data from a URL
 * @param {string} url - RSS feed URL
 * @returns {Promise<Object|null>} - RSS feed data or null if failed
 */
async function fetchFeedData(url) {
  try {
    const response = await axios.get(url)
    return response.data
  } catch (error) {
    logger.error(`Error fetching feed data from ${url}:`, error)
    return null
  }
}

module.exports = {
  fetchContent,
  fetchFeedData,
}
