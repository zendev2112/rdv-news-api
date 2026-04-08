/**
 * Improved content scraper for RDV News.
 *
 * Addresses the main scraping weaknesses:
 * - Better User-Agent rotation
 * - Retries with backoff
 * - Pre-cleaning HTML before Readability (remove ads, navs, sidebars)
 * - Targeted extraction for known Argentine news sites
 * - Fallback chain: Readability → targeted selectors → raw text
 */

import axios from 'axios'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import * as cheerio from 'cheerio'

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
]

/**
 * Selectors to REMOVE before extraction — these pollute Readability results
 */
const NOISE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'iframe:not([src*="youtube"]):not([src*="instagram"]):not([src*="facebook"]):not([src*="twitter"])',
  'header:not(article header)',
  'footer:not(article footer)',
  'nav',
  '.nav',
  '.navigation',
  '.menu',
  '.breadcrumb',
  '.sidebar',
  '.aside',
  'aside',
  '.ads',
  '.ad-container',
  '.ad-wrapper',
  '[class*="ad-"]',
  '[id*="ad-"]',
  '[class*="banner"]',
  '[class*="publicidad"]',
  '.social-share',
  '.share-buttons',
  '.social-links',
  '.related-articles',
  '.related-posts',
  '.recommended',
  '.comments',
  '#comments',
  '.comment-section',
  '.newsletter',
  '.subscription',
  '.subscribe',
  '.cookie-notice',
  '.cookie-banner',
  '.popup',
  '.modal',
  '.overlay',
  '.widget',
  '.widgets',
  '.author-bio',
  '.author-box',
  '.tags-list',
  '.tag-cloud',
  '.pagination',
  '.pager',
  '.wp-block-latest-posts',
  '.wp-block-calendar',
]

/**
 * Selectors to try for main content extraction (in priority order)
 */
const CONTENT_SELECTORS = [
  '[itemprop="articleBody"]',
  'article .entry-content',
  'article .post-content',
  'article .article-body',
  'article .article-content',
  '.entry-content',
  '.post-content',
  '.article-body',
  '.article-content',
  '.story-content',
  '.nota-cuerpo', // Common in Argentine news sites
  '.cuerpo-nota', // Common in Argentine news sites
  '.body-nota',
  '#article-body',
  'article',
  'main',
  '#main-content',
  '.content',
]

/**
 * Fetch HTML content with retries and better headers
 * @param {string} url - URL to fetch
 * @param {Object} options - { timeout, maxRetries }
 * @returns {Promise<string|null>}
 */
export async function fetchContent(url, options = {}) {
  const { timeout = 15000, maxRetries = 2 } = options
  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url, {
        timeout,
        maxRedirects: 5,
        headers: {
          'User-Agent': userAgent,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-AR,es;q=0.9,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          Connection: 'keep-alive',
          'Cache-Control': 'no-cache',
        },
        // Handle encoding properly
        responseType: 'text',
        transformResponse: [(data) => data],
      })

      if (
        response.status === 200 &&
        response.data &&
        response.data.length > 500
      ) {
        return response.data
      }

      console.warn(
        `⚠️ Fetch attempt ${attempt + 1}: status=${response.status}, length=${response.data?.length || 0}`,
      )
    } catch (error) {
      const isLastAttempt = attempt === maxRetries
      if (isLastAttempt) {
        console.error(
          `❌ Failed to fetch ${url} after ${maxRetries + 1} attempts: ${error.message}`,
        )
        return null
      }
      console.warn(
        `⚠️ Fetch attempt ${attempt + 1} failed: ${error.message}. Retrying...`,
      )
      // Exponential backoff
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    }
  }

  return null
}

/**
 * Pre-clean HTML by removing noise elements before Readability processes it.
 * This dramatically improves extraction quality.
 * @param {string} html - Raw HTML
 * @returns {string} - Cleaned HTML
 */
export function preCleanHtml(html) {
  const $ = cheerio.load(html)

  // Remove noise elements
  for (const selector of NOISE_SELECTORS) {
    try {
      $(selector).remove()
    } catch {
      // Skip invalid selectors
    }
  }

  // Remove hidden elements
  $(
    '[style*="display:none"], [style*="display: none"], [hidden], .hidden, .d-none',
  ).remove()

  // Remove empty divs that add noise
  $('div').each(function () {
    const $el = $(this)
    if (
      $el.text().trim().length === 0 &&
      $el.find('img, video, iframe').length === 0
    ) {
      $el.remove()
    }
  })

  return $.html()
}

/**
 * Extract text using Readability with pre-cleaned HTML
 * @param {string} html - Raw HTML content
 * @returns {{ text: string, title: string, excerpt: string }}
 */
export function extractWithReadability(html) {
  try {
    const cleanedHtml = preCleanHtml(html)
    const dom = new JSDOM(cleanedHtml, { url: 'https://example.com' })
    const reader = new Readability(dom.window.document, {
      charThreshold: 100,
      nbTopCandidates: 10,
    })
    const article = reader.parse()

    if (
      article &&
      article.textContent &&
      article.textContent.trim().length > 100
    ) {
      return {
        text: article.textContent.trim(),
        title: article.title || '',
        excerpt: article.excerpt || '',
      }
    }
  } catch (error) {
    console.warn(`⚠️ Readability extraction failed: ${error.message}`)
  }

  return null
}

/**
 * Extract text using targeted CSS selectors (fallback for when Readability fails)
 * @param {string} html - Raw HTML content
 * @returns {string|null}
 */
export function extractWithSelectors(html) {
  try {
    const $ = cheerio.load(html)

    // Remove noise first
    for (const selector of NOISE_SELECTORS) {
      try {
        $(selector).remove()
      } catch {
        /* skip */
      }
    }

    // Try each content selector in priority order
    for (const selector of CONTENT_SELECTORS) {
      const $el = $(selector)
      if ($el.length > 0) {
        // Get paragraphs within the content area
        const paragraphs = []
        $el.find('p').each(function () {
          const text = $(this).text().trim()
          if (text.length > 30) {
            paragraphs.push(text)
          }
        })

        if (paragraphs.length >= 2) {
          const fullText = paragraphs.join('\n\n')
          if (fullText.length > 200) {
            console.log(
              `✅ Selector extraction succeeded with: ${selector} (${paragraphs.length} paragraphs)`,
            )
            return fullText
          }
        }
      }
    }
  } catch (error) {
    console.warn(`⚠️ Selector extraction failed: ${error.message}`)
  }

  return null
}

/**
 * Main extraction pipeline — tries multiple strategies in order
 * @param {string} html - Raw HTML content
 * @returns {{ text: string, title: string, excerpt: string, method: string }}
 */
export function extractText(html) {
  if (!html || html.length < 100) {
    return { text: '', title: '', excerpt: '', method: 'none' }
  }

  // Strategy 1: Readability with pre-cleaned HTML
  const readabilityResult = extractWithReadability(html)
  if (readabilityResult && readabilityResult.text.length > 200) {
    console.log(
      `✅ Text extracted via Readability (${readabilityResult.text.length} chars)`,
    )
    return { ...readabilityResult, method: 'readability' }
  }

  // Strategy 2: Targeted CSS selectors
  const selectorText = extractWithSelectors(html)
  if (selectorText && selectorText.length > 200) {
    console.log(
      `✅ Text extracted via CSS selectors (${selectorText.length} chars)`,
    )
    return { text: selectorText, title: '', excerpt: '', method: 'selectors' }
  }

  // Strategy 3: Raw Readability without pre-cleaning (some sites break with cheerio)
  try {
    const dom = new JSDOM(html, { url: 'https://example.com' })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()
    if (
      article &&
      article.textContent &&
      article.textContent.trim().length > 100
    ) {
      console.log(
        `✅ Text extracted via raw Readability (${article.textContent.length} chars)`,
      )
      return {
        text: article.textContent.trim(),
        title: article.title || '',
        excerpt: article.excerpt || '',
        method: 'readability-raw',
      }
    }
  } catch {
    // Continue to next strategy
  }

  // Strategy 4: Last resort — extract all <p> tags from body
  try {
    const $ = cheerio.load(html)
    const paragraphs = []
    $('body p').each(function () {
      const text = $(this).text().trim()
      if (text.length > 30) {
        paragraphs.push(text)
      }
    })
    if (paragraphs.length >= 2) {
      const text = paragraphs.join('\n\n')
      console.log(
        `⚠️ Text extracted via body <p> fallback (${text.length} chars)`,
      )
      return { text, title: '', excerpt: '', method: 'body-paragraphs' }
    }
  } catch {
    // All strategies exhausted
  }

  console.warn('❌ All extraction strategies failed')
  return { text: '', title: '', excerpt: '', method: 'none' }
}

/**
 * Extract images with captions from HTML
 * @param {string} html - Raw HTML
 * @returns {{ images: string[], markdown: string }}
 */
export function extractImagesAsMarkdown(html) {
  try {
    const $ = cheerio.load(html)
    const extractedImages = []
    let imageMarkdown = ''

    // Extract figures with captions
    $('figure').each((i, figure) => {
      const $figure = $(figure)
      const $img = $figure.find('img')
      const $caption = $figure.find('figcaption')

      if (
        $img.length &&
        $img.attr('src') &&
        $caption.length &&
        $caption.text().trim()
      ) {
        const imageUrl = $img.attr('src')
        if (isValidImageUrl(imageUrl)) {
          const caption = $caption.text().trim()
          extractedImages.push({ url: imageUrl, caption })
          imageMarkdown += `**Imagen:** ${caption}\n\n`
        }
      }
    })

    // Extract standalone images with nearby captions
    $('img').each((i, img) => {
      const $img = $(img)
      if ($img.closest('figure').length === 0) {
        const imageUrl = $img.attr('src')
        if (!imageUrl || !isValidImageUrl(imageUrl)) return

        const width = parseInt($img.attr('width') || '0', 10)
        const height = parseInt($img.attr('height') || '0', 10)
        if ((width > 0 && width < 100) || (height > 0 && height < 100)) return

        // Look for nearby caption
        let caption = ''
        const $next = $img.next()
        const $parentNext = $img.parent().next()

        if ($next.is('em, small, span.caption, .caption')) {
          caption = $next.text().trim()
        } else if (
          $parentNext.is('em, small, span.caption, .caption, p.wp-caption-text')
        ) {
          caption = $parentNext.text().trim()
        }

        if (caption && !extractedImages.some((img) => img.url === imageUrl)) {
          extractedImages.push({ url: imageUrl, caption })
          imageMarkdown += `**Imagen:** ${caption}\n\n`
        }
      }
    })

    console.log(`Extracted ${extractedImages.length} captioned images`)
    return {
      images: extractedImages.map((img) => img.url),
      markdown: imageMarkdown,
    }
  } catch (error) {
    console.error('Error extracting images:', error.message)
    return { images: [], markdown: '' }
  }
}

/**
 * Check if a URL is a valid content image (not an icon, ad, tracker, etc.)
 */
function isValidImageUrl(url) {
  if (!url) return false
  if (url.startsWith('data:')) return false
  if (url.includes('.svg')) return false
  if (url.includes('ad.') || url.includes('ads.')) return false
  if (url.includes('pixel.') || url.includes('analytics')) return false
  if (url.includes('/icons/') || url.includes('/social/')) return false
  if (url.includes('tracking') || url.includes('beacon')) return false
  return true
}
