const { JSDOM } = require('jsdom')
const logger = require('../../utils/logger')

/**
 * Extracts Facebook embeds from HTML content
 * @param {string} htmlContent - Raw HTML content
 * @returns {string|null} - Facebook embed HTML or null if none found
 */

function extractFacebookEmbeds(htmlContent) {
  try {
    const dom = new JSDOM(htmlContent)
    const document = dom.window.document

    // Find Facebook embeds using various selectors
    let facebookDivs = Array.from(
      document.querySelectorAll(
        'div.fb-post, ' +
          'div.fb-video, ' +
          'div[class*="facebook"], ' +
          'div[data-href*="facebook.com"]'
      )
    )

    // Filter out bottomFacebookLike elements and other social sharing buttons
    facebookDivs = facebookDivs.filter((div) => {
      // Exclude by class name
      if (
        div.className &&
        (div.className.includes('bottomFacebookLike') ||
          div.className.includes('facebook-like') ||
          div.className.includes('facebook-share') ||
          div.className.includes('share-button') ||
          div.className.includes('social-button'))
      ) {
        return false
      }

      // Exclude by content indication (like buttons typically have these attributes)
      if (
        div.getAttribute('data-layout') === 'button' ||
        div.getAttribute('data-action') === 'like' ||
        div.getAttribute('data-share') === 'true'
      ) {
        return false
      }

      // Check for parent elements that might indicate this is a social sharing section
      let parent = div.parentElement
      for (let i = 0; i < 3 && parent; i++) {
        // Check up to 3 levels up
        if (
          parent.className &&
          (parent.className.includes('share') ||
            parent.className.includes('social') ||
            parent.className.includes('like'))
        ) {
          return false
        }
        parent = parent.parentElement
      }

      return true
    })

    // Find Facebook iframes
    let facebookIframes = Array.from(
      document.querySelectorAll('iframe[src*="facebook.com"]')
    )

    // Filter out like button iframes
    facebookIframes = facebookIframes.filter((iframe) => {
      // Exclude Facebook like buttons which typically have these in the URL
      return !(
        iframe.src.includes('/plugins/like.php') ||
        iframe.src.includes('/plugins/share_button.php')
      )
    })

    // Find Facebook post links that might need to be converted to embeds
    const facebookLinks = Array.from(
      document.querySelectorAll('a[href*="facebook.com/"]')
    ).filter((link) => {
      // Only consider links that look like post links, not like buttons or profile links
      return (
        link.href &&
        (link.href.match(/facebook\.com\/[^\/]+\/posts\//) ||
          link.href.match(/facebook\.com\/permalink\.php/) ||
          link.href.match(/facebook\.com\/photo\.php/) ||
          link.href.match(/facebook\.com\/video\.php/)) &&
        // Exclude if the link is part of a sharing widget
        !(
          (link.className &&
            (link.className.includes('share') ||
              link.className.includes('like') ||
              link.className.includes('social'))) ||
          (link.parentElement &&
            link.parentElement.className &&
            (link.parentElement.className.includes('share') ||
              link.parentElement.className.includes('like') ||
              link.parentElement.className.includes('social')))
        )
      )
    })

    // Process all types of Facebook content
    let facebookContent = null

    // First priority: divs with FB embed codes
    if (facebookDivs.length > 0) {
      facebookContent = facebookDivs[0].outerHTML
      console.log(
        'Found Facebook div:',
        facebookContent.substring(0, 100) + '...'
      )
    }
    // Second priority: iframes
    else if (facebookIframes.length > 0) {
      facebookContent = facebookIframes[0].outerHTML
      console.log(
        'Found Facebook iframe:',
        facebookContent.substring(0, 100) + '...'
      )
    }
    // Third priority: convert links to embed code
    else if (facebookLinks.length > 0) {
      const facebookUrl = facebookLinks[0].href
      // Create an embed code
      facebookContent = `<div class="fb-post" data-href="${facebookUrl}" data-width="500"></div>`
      console.log('Created Facebook embed from link:', facebookContent)
    }

    // Add additional validation to ensure we're not returning a like button
    if (facebookContent) {
      // Check for common like button indicators in the content
      if (
        facebookContent.includes('plugins/like.php') ||
        facebookContent.includes('bottomFacebookLike') ||
        facebookContent.includes('data-layout="button"')
      ) {
        console.log(
          'Detected like button, skipping:',
          facebookContent.substring(0, 100)
        )
        return null
      }
    }

    return facebookContent
  } catch (error) {
    console.error('Error extracting Facebook embeds:', error.message)
    if (error.stack) {
      console.error('Stack trace:', error.stack)
    }
    return null
  }
}

module.exports = {
  extractFacebookEmbeds,
}
