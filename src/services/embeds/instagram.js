import { JSDOM } from 'jsdom';
import logger from '../../utils/logger.js'


/**
 * Extracts Instagram embeds from HTML content
 * @param {string} htmlContent - Raw HTML content
 * @returns {string|null} - Instagram embed HTML or null if none found
 */
function extractInstagramEmbeds(htmlContent) {
  try {
    const dom = new JSDOM(htmlContent)
    const document = dom.window.document

    // Find Instagram embeds
    const instagramBlockquotes = Array.from(
      document.querySelectorAll(
        'blockquote.instagram-media, ' +
          'blockquote[data-instgrm-permalink], ' +
          'blockquote[data-instgrm-captioned]'
      )
    )

    const instagramIframes = Array.from(
      document.querySelectorAll('iframe[src*="instagram.com"]')
    )

    const instagramLinks = Array.from(
      document.querySelectorAll('a[href*="instagram.com/p/"]')
    ).filter((link) => {
      return link.href && link.href.match(/instagram\.com\/p\/[\w-]+\/?/)
    })

    // Process found Instagram content
    let instagramContent = null

    if (instagramBlockquotes.length > 0) {
      instagramContent = instagramBlockquotes[0].outerHTML
      logger.debug('Found Instagram blockquote')
    } else if (instagramIframes.length > 0) {
      instagramContent = instagramIframes[0].outerHTML
      logger.debug('Found Instagram iframe')
    } else if (instagramLinks.length > 0) {
      const instagramUrl = instagramLinks[0].href
      const match = instagramUrl.match(/instagram\.com\/p\/([\w-]+)/)
      if (match && match[1]) {
        const postId = match[1]
        instagramContent = `<blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/p/${postId}/" data-instgrm-version="14"></blockquote>`
        logger.debug('Created Instagram embed from link')
      }
    }

    return instagramContent
  } catch (error) {
    logger.error(`Error extracting Instagram embeds:`, error)
    return null
  }
}

export { extractInstagramEmbeds };
