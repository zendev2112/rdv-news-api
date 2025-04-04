import { JSDOM } from 'jsdom';
import logger from '../../utils/logger.js'


/**
 * Extracts Twitter embeds from HTML content
 * @param {string} htmlContent - Raw HTML content
 * @returns {string|null} - Twitter embed HTML or null if none found
 */

// Function to extract Twitter embeds from HTML content
function extractTwitterEmbeds(htmlContent) {
  try {
    const dom = new JSDOM(htmlContent)
    const document = dom.window.document

    // Find Twitter embeds using various selectors
    const twitterBlockquotes = Array.from(
      document.querySelectorAll(
        'blockquote.twitter-tweet, ' +
          'blockquote[data-tweet-id], ' +
          'blockquote[class*="twitter"]'
      )
    )

    // Find Twitter iframes
    const twitterIframes = Array.from(
      document.querySelectorAll(
        'iframe[src*="twitter.com"], iframe[src*="platform.twitter.com"]'
      )
    )

    // Find Twitter links that might need to be converted to embeds
    const twitterLinks = Array.from(
      document.querySelectorAll('a[href*="twitter.com/"], a[href*="x.com/"]')
    ).filter((link) => {
      // Only consider links that are likely to be tweet links
      return (
        link.href &&
        (link.href.match(/twitter\.com\/[^\/]+\/status\/\d+/) ||
          link.href.match(/x\.com\/[^\/]+\/status\/\d+/))
      )
    })

    // Process all types of Twitter content
    let twitterContent = null

    // First priority: blockquotes (official embed code)
    if (twitterBlockquotes.length > 0) {
      twitterContent = twitterBlockquotes[0].outerHTML
      console.log(
        'Found Twitter blockquote:',
        twitterContent.substring(0, 100) + '...'
      )
    }
    // Second priority: iframes
    else if (twitterIframes.length > 0) {
      twitterContent = twitterIframes[0].outerHTML
      console.log(
        'Found Twitter iframe:',
        twitterContent.substring(0, 100) + '...'
      )
    }
    // Third priority: convert links to embed code
    else if (twitterLinks.length > 0) {
      // Extract the tweet URL
      const twitterUrl = twitterLinks[0].href

      // Match the tweet ID - works for both twitter.com and x.com
      const match = twitterUrl.match(
        /(?:twitter|x)\.com\/([^\/]+)\/status\/(\d+)/
      )

      if (match && match[2]) {
        const username = match[1]
        const tweetId = match[2]

        // Create an embed code
        twitterContent = `<blockquote class="twitter-tweet" data-lang="en">
          <a href="https://twitter.com/${username}/status/${tweetId}"></a>
        </blockquote>`

        console.log('Created Twitter embed from link:', twitterContent)
      }
    }

    // Filter out Twitter share buttons and widgets that aren't actual embedded tweets
    if (twitterContent) {
      // Skip Twitter share buttons and widgets
      if (
        twitterContent.includes('share-button') ||
        twitterContent.includes('twitter-share') ||
        twitterContent.includes('twitter-follow') ||
        twitterContent.includes('twitter-hashtag')
      ) {
        console.log('Detected Twitter share/follow button, skipping')
        return null
      }
    }

    return twitterContent
  } catch (error) {
    console.error('Error extracting Twitter embeds:', error.message)
    if (error.stack) {
      console.error('Stack trace:', error.stack)
    }
    return null
  }
}

export { extractTwitterEmbeds };
