const { JSDOM } = require('jsdom')
const { Readability } = require('@mozilla/readability')
const logger = require('../utils/logger')

/**
 * Extracts main text content from HTML using Readability
 * @param {string} htmlContent - Raw HTML content
 * @returns {string} - Extracted text content
 */
function extractText(htmlContent) {
  try {
    const dom = new JSDOM(htmlContent)
    const reader = new Readability(dom.window.document)
    const article = reader.parse()
    return article && article.textContent ? article.textContent.trim() : ''
  } catch (error) {
    logger.error(`Error extracting text:`, error)
    return ''
  }
}

module.exports = {
  extractText,
}
