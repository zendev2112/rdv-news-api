/**
 * Improved content scraper for RDV News.
 *
 * Addresses the main scraping weaknesses:
 * - Better User-Agent rotation
 * - Retries with backoff
 * - Pre-cleaning HTML before Readability (remove ads, navs, sidebars)
 * - Targeted extraction for known Argentine news sites
 * - JSON-LD / structured data extraction (bypasses paywalls)
 * - __NEXT_DATA__ extraction for Next.js sites (Infobae, etc.)
 * - Google referrer to bypass metered paywalls
 * - Fallback chain: JSON-LD → __NEXT_DATA__ → Readability → selectors → raw text
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
 * Known paywall / JS-heavy sites that need special handling
 */
const PAYWALL_DOMAINS = ['clarin.com', 'lanacion.com.ar', 'pagina12.com.ar']

const NEXTJS_DOMAINS = ['infobae.com']

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
  // Infobae-specific
  '.article-body-content',
  '.article-story-content',
  '[data-component="article-body"]',
  // Clarin-specific
  '.body-nota .content-nota',
  '.body-nota',
  '#nota-body-text',
  '.nota-txt',
  // La Nacion-specific
  '#cuerpo',
  '.com-nota .cuerpo',
  // Pagina12-specific
  '.article-main-content',
  '.article-text',
  // Generic news
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
 * Fetch HTML content with retries and better headers.
 * Uses Google referrer for paywall sites.
 * @param {string} url - URL to fetch
 * @param {Object} options - { timeout, maxRetries }
 * @returns {Promise<string|null>}
 */
export async function fetchContent(url, options = {}) {
  const { timeout = 15000, maxRetries = 2 } = options
  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]

  // Detect if this is a paywall site
  const isPaywallSite = PAYWALL_DOMAINS.some((d) => url.includes(d))

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
          // Google referrer helps bypass metered paywalls
          Referer: 'https://www.google.com/',
          ...(isPaywallSite && {
            'X-Forwarded-For': '66.249.66.1',
            Via: '1.1 google',
          }),
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
 * Extract article content from JSON-LD structured data.
 * Many news sites embed the full article body in <script type="application/ld+json">
 * for SEO/Google News. This often bypasses paywalls entirely.
 * @param {string} html - Raw HTML
 * @returns {{ text: string, title: string, excerpt: string } | null}
 */
export function extractFromJsonLd(html) {
  try {
    const $ = cheerio.load(html)
    const jsonLdScripts = $('script[type="application/ld+json"]')

    for (let i = 0; i < jsonLdScripts.length; i++) {
      try {
        const raw = $(jsonLdScripts[i]).html()
        if (!raw) continue

        const data = JSON.parse(raw)
        // Handle arrays of schemas (common pattern)
        const schemas = Array.isArray(data) ? data : [data]

        for (const schema of schemas) {
          // Look for NewsArticle, Article, ReportageNewsArticle, etc.
          const schemaType = schema['@type'] || ''
          const isArticle =
            typeof schemaType === 'string'
              ? schemaType.toLowerCase().includes('article')
              : Array.isArray(schemaType) &&
                schemaType.some((t) => t.toLowerCase().includes('article'))

          if (!isArticle) continue

          // articleBody is the jackpot — full content
          let body = schema.articleBody || ''

          // Some sites use text instead
          if (!body) body = schema.text || ''

          // Clean up body: remove HTML tags if present
          if (body.includes('<')) {
            const bodyDom = cheerio.load(body)
            body = bodyDom.text()
          }

          if (body && body.length > 200) {
            console.log(
              `✅ Extracted ${body.length} chars from JSON-LD articleBody`,
            )
            return {
              text: body.trim(),
              title: schema.headline || schema.name || '',
              excerpt: schema.description || '',
            }
          }
        }
      } catch {
        // Invalid JSON in this script tag, try the next one
      }
    }
  } catch (error) {
    console.warn(`⚠️ JSON-LD extraction failed: ${error.message}`)
  }

  return null
}

/**
 * Extract article content from __NEXT_DATA__ (for Next.js sites like Infobae).
 * Next.js embeds the full server-rendered data in a JSON blob.
 * @param {string} html - Raw HTML
 * @returns {{ text: string, title: string, excerpt: string } | null}
 */
export function extractFromNextData(html) {
  try {
    const $ = cheerio.load(html)
    const nextDataScript = $('script#__NEXT_DATA__')

    if (nextDataScript.length === 0) return null

    const raw = nextDataScript.html()
    if (!raw) return null

    const data = JSON.parse(raw)
    const props = data?.props?.pageProps

    if (!props) return null

    // Navigate common Next.js article data structures
    // Infobae uses different paths depending on article type
    const article =
      props.article ||
      props.data?.article ||
      props.content ||
      props.post ||
      props

    if (!article) return null

    // Try to extract body/content from the article object
    let bodyText = ''
    let title = ''
    let excerpt = ''

    // Try various field names used by different Next.js sites
    const bodyFields = [
      'body',
      'content',
      'text',
      'articleBody',
      'plainText',
      'rawContent',
    ]
    const titleFields = ['title', 'headline', 'name']
    const excerptFields = [
      'summary',
      'description',
      'excerpt',
      'subheadline',
      'bajada',
    ]

    for (const field of titleFields) {
      if (article[field] && typeof article[field] === 'string') {
        title = article[field]
        break
      }
    }

    for (const field of excerptFields) {
      if (article[field] && typeof article[field] === 'string') {
        excerpt = article[field]
        break
      }
    }

    for (const field of bodyFields) {
      const val = article[field]
      if (!val) continue

      if (typeof val === 'string' && val.length > 200) {
        bodyText = val
        break
      }

      // Some sites store body as array of content blocks
      if (Array.isArray(val)) {
        const texts = val
          .map((block) => {
            if (typeof block === 'string') return block
            if (block.text) return block.text
            if (block.content) return block.content
            if (block.value) return block.value
            // Infobae content blocks have type + value
            if (block.type === 'text' || block.type === 'paragraph') {
              return block.value || block.text || ''
            }
            return ''
          })
          .filter((t) => t.length > 0)

        if (texts.length > 0) {
          bodyText = texts.join('\n\n')
          break
        }
      }
    }

    // Deep search: walk the props tree for any large text blob
    if (!bodyText || bodyText.length < 200) {
      bodyText = deepSearchForContent(props) || bodyText
    }

    // Clean HTML tags from body if present
    if (bodyText && bodyText.includes('<')) {
      const bodyDom = cheerio.load(bodyText)
      bodyText = bodyDom.text()
    }

    if (bodyText && bodyText.length > 200) {
      console.log(`✅ Extracted ${bodyText.length} chars from __NEXT_DATA__`)
      return { text: bodyText.trim(), title, excerpt }
    }
  } catch (error) {
    console.warn(`⚠️ __NEXT_DATA__ extraction failed: ${error.message}`)
  }

  return null
}

/**
 * Recursively search a JSON object for the longest text string
 * that looks like article content. Used as last resort for __NEXT_DATA__.
 */
function deepSearchForContent(obj, depth = 0) {
  if (depth > 8 || !obj) return ''

  let best = ''

  if (typeof obj === 'string') {
    // Only consider strings that look like article paragraphs
    if (obj.length > 300 && !obj.startsWith('http') && !obj.startsWith('{')) {
      return obj
    }
    return ''
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepSearchForContent(item, depth + 1)
      if (found.length > best.length) best = found
    }
    return best
  }

  if (typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      // Skip keys that are clearly not content
      if (
        [
          '_id',
          'id',
          'url',
          'href',
          'src',
          'image',
          'photo',
          'video',
          'ads',
          'tracking',
          'analytics',
          'config',
          'seo',
          'meta',
        ].includes(key)
      )
        continue

      const found = deepSearchForContent(obj[key], depth + 1)
      if (found.length > best.length) best = found
    }
  }

  return best
}

/**
 * Extract content from RSS feed's content_html field.
 * Useful for social media where content_text may be truncated but content_html has more.
 * @param {string} contentHtml - HTML content from RSS feed item
 * @returns {string}
 */
export function extractFromContentHtml(contentHtml) {
  if (!contentHtml || contentHtml.length < 10) return ''

  try {
    const $ = cheerio.load(contentHtml)

    // Remove common noise from RSS HTML
    $('script, style, img, video, iframe').remove()

    // Get text from paragraphs
    const paragraphs = []
    $('p, div, span, li').each(function () {
      const text = $(this).text().trim()
      if (text.length > 20) {
        paragraphs.push(text)
      }
    })

    if (paragraphs.length > 0) {
      // Deduplicate (nested elements can repeat text)
      const seen = new Set()
      const unique = paragraphs.filter((p) => {
        if (seen.has(p)) return false
        // Also skip if this text is contained in a longer paragraph we already have
        for (const existing of seen) {
          if (existing.includes(p) || p.includes(existing)) {
            // Keep the longer one
            if (p.length > existing.length) {
              seen.delete(existing)
              seen.add(p)
            }
            return false
          }
        }
        seen.add(p)
        return true
      })

      return unique.join('\n\n')
    }

    // Fallback: just get all text
    const allText = $('body').text().trim() || $.text().trim()
    return allText
  } catch {
    // If HTML parsing fails, strip tags manually
    return contentHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
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
 * Main extraction pipeline — tries multiple strategies in order.
 * Prioritizes structured data (JSON-LD, __NEXT_DATA__) which bypass paywalls,
 * then falls back to DOM-based extraction.
 * @param {string} html - Raw HTML content
 * @returns {{ text: string, title: string, excerpt: string, method: string }}
 */
export function extractText(html) {
  if (!html || html.length < 100) {
    return { text: '', title: '', excerpt: '', method: 'none' }
  }

  // Strategy 1: JSON-LD structured data (bypasses paywalls, highest quality)
  const jsonLdResult = extractFromJsonLd(html)
  if (jsonLdResult && jsonLdResult.text.length > 200) {
    console.log(
      `✅ Text extracted via JSON-LD (${jsonLdResult.text.length} chars)`,
    )
    return { ...jsonLdResult, method: 'json-ld' }
  }

  // Strategy 2: __NEXT_DATA__ for Next.js sites (Infobae, etc.)
  const nextDataResult = extractFromNextData(html)
  if (nextDataResult && nextDataResult.text.length > 200) {
    console.log(
      `✅ Text extracted via __NEXT_DATA__ (${nextDataResult.text.length} chars)`,
    )
    return { ...nextDataResult, method: 'next-data' }
  }

  // Strategy 3: Readability with pre-cleaned HTML
  const readabilityResult = extractWithReadability(html)
  if (readabilityResult && readabilityResult.text.length > 200) {
    console.log(
      `✅ Text extracted via Readability (${readabilityResult.text.length} chars)`,
    )
    return { ...readabilityResult, method: 'readability' }
  }

  // Strategy 4: Targeted CSS selectors
  const selectorText = extractWithSelectors(html)
  if (selectorText && selectorText.length > 200) {
    console.log(
      `✅ Text extracted via CSS selectors (${selectorText.length} chars)`,
    )
    return { text: selectorText, title: '', excerpt: '', method: 'selectors' }
  }

  // Strategy 5: Raw Readability without pre-cleaning (some sites break with cheerio)
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

  // Strategy 6: Last resort — extract all <p> tags from body
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

// ─────────────────────────────────────────────────────────────
// MINIMUM CONTENT THRESHOLD
// If extracted text is below this, we consider it "cropped" and
// try alternate sources. 400 chars ≈ 2 short paragraphs.
// ─────────────────────────────────────────────────────────────
const MIN_QUALITY_CHARS = 400

/**
 * Fetch page HTML from Google's web cache.
 * Google cache stores the fully-rendered page, so it often has content
 * that JS-rendered or paywalled sites don't serve to bots.
 * @param {string} url - Original article URL
 * @param {number} timeout - Request timeout in ms
 * @returns {Promise<string|null>}
 */
export async function fetchGoogleCache(url, timeout = 15000) {
  try {
    const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}&hl=es`
    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]

    const response = await axios.get(cacheUrl, {
      timeout,
      maxRedirects: 5,
      headers: {
        'User-Agent': ua,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.5',
      },
      responseType: 'text',
      transformResponse: [(data) => data],
    })

    if (
      response.status === 200 &&
      response.data &&
      response.data.length > 1000
    ) {
      console.log(
        `✅ Fetched Google Cache version (${response.data.length} chars)`,
      )
      return response.data
    }
  } catch (error) {
    console.warn(`⚠️ Google Cache not available: ${error.message}`)
  }
  return null
}

/**
 * Try fetching the AMP version of a URL.
 * AMP pages are lighter, often lack paywalls, and have full article content.
 * @param {string} url - Original article URL
 * @param {number} timeout - Request timeout in ms
 * @returns {Promise<string|null>}
 */
export async function fetchAmpVersion(url, timeout = 15000) {
  // Common AMP URL patterns
  const ampUrls = []

  try {
    const parsed = new URL(url)

    // Pattern 1: /amp/ suffix
    if (
      !parsed.pathname.endsWith('/amp') &&
      !parsed.pathname.endsWith('/amp/')
    ) {
      ampUrls.push(`${parsed.origin}${parsed.pathname.replace(/\/$/, '')}/amp`)
    }

    // Pattern 2: amp subdomain
    ampUrls.push(`${parsed.protocol}//amp.${parsed.hostname}${parsed.pathname}`)

    // Pattern 3: ?amp=1 query parameter
    parsed.searchParams.set('amp', '1')
    ampUrls.push(parsed.href)
  } catch {
    return null
  }

  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]

  for (const ampUrl of ampUrls) {
    try {
      const response = await axios.get(ampUrl, {
        timeout,
        maxRedirects: 5,
        headers: {
          'User-Agent': ua,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-AR,es;q=0.9,en;q=0.5',
          Referer: 'https://www.google.com/',
        },
        responseType: 'text',
        transformResponse: [(data) => data],
        // Don't throw on 404
        validateStatus: (status) => status < 500,
      })

      if (
        response.status === 200 &&
        response.data &&
        response.data.length > 1000
      ) {
        // Verify this is actually an AMP page or at least has article content
        const hasContent =
          response.data.includes('<article') ||
          response.data.includes('amp-') ||
          response.data.includes('articleBody') ||
          response.data.length > 5000

        if (hasContent) {
          console.log(
            `✅ Fetched AMP version from: ${ampUrl} (${response.data.length} chars)`,
          )
          return response.data
        }
      }
    } catch {
      // This AMP URL pattern didn't work, try next
    }
  }

  return null
}

/**
 * Comprehensive article scraping function.
 * Tries multiple fetch sources and extraction strategies to get the fullest content.
 *
 * Order:
 *   1. Direct fetch → extract (JSON-LD, __NEXT_DATA__, Readability, selectors)
 *   2. If content looks truncated → try AMP version
 *   3. If still truncated → try Google Cache
 *   4. If all fetches fail or content is still short → use RSS feed content as last resort
 *
 * @param {string} url - Article URL to scrape
 * @param {Object} options
 * @param {number} options.timeout - Fetch timeout (default 15000)
 * @param {string} options.rssContentText - content_text from RSS feed item (fallback)
 * @param {string} options.rssContentHtml - content_html from RSS feed item (fallback)
 * @param {string} options.rssTitle - title from RSS feed item
 * @returns {Promise<{ text: string, title: string, excerpt: string, method: string, html: string|null }>}
 */
export async function scrapeArticle(url, options = {}) {
  const {
    timeout = 15000,
    rssContentText = '',
    rssContentHtml = '',
    rssTitle = '',
  } = options

  let bestResult = { text: '', title: '', excerpt: '', method: 'none' }
  let bestHtml = null

  // ── SOURCE 1: Direct fetch ──────────────────────────────────────
  const directHtml = await fetchContent(url, { timeout, maxRetries: 2 })
  if (directHtml) {
    bestHtml = directHtml
    const directResult = extractText(directHtml)

    if (directResult.text.length >= MIN_QUALITY_CHARS) {
      console.log(
        `📰 Direct scrape: ${directResult.text.length} chars via ${directResult.method}`,
      )
      return { ...directResult, html: directHtml }
    }

    // Keep as best so far even if short
    if (directResult.text.length > bestResult.text.length) {
      bestResult = directResult
    }

    console.warn(
      `⚠️ Direct scrape only got ${directResult.text.length} chars (min: ${MIN_QUALITY_CHARS}), trying alternates...`,
    )
  }

  // ── SOURCE 2: AMP version ──────────────────────────────────────
  const ampHtml = await fetchAmpVersion(url, timeout)
  if (ampHtml) {
    const ampResult = extractText(ampHtml)

    if (ampResult.text.length > bestResult.text.length) {
      bestResult = { ...ampResult, method: `amp+${ampResult.method}` }
      bestHtml = ampHtml
      console.log(
        `📰 AMP scrape: ${ampResult.text.length} chars via ${ampResult.method}`,
      )
    }

    if (bestResult.text.length >= MIN_QUALITY_CHARS) {
      return { ...bestResult, html: bestHtml }
    }
  }

  // ── SOURCE 3: Google Cache ──────────────────────────────────────
  const cacheHtml = await fetchGoogleCache(url, timeout)
  if (cacheHtml) {
    const cacheResult = extractText(cacheHtml)

    if (cacheResult.text.length > bestResult.text.length) {
      bestResult = { ...cacheResult, method: `cache+${cacheResult.method}` }
      bestHtml = cacheHtml
      console.log(
        `📰 Google Cache: ${cacheResult.text.length} chars via ${cacheResult.method}`,
      )
    }

    if (bestResult.text.length >= MIN_QUALITY_CHARS) {
      return { ...bestResult, html: bestHtml }
    }
  }

  // ── SOURCE 4: RSS feed content as last resort ──────────────────
  // RSS.app only provides summaries (~150-300 chars) but it's better than nothing
  if (bestResult.text.length < 100) {
    let rssText = rssContentText || ''

    // Try extracting from content_html if content_text is short
    if (rssText.length < 100 && rssContentHtml) {
      rssText = extractFromContentHtml(rssContentHtml)
    }

    if (rssText && rssText.length > bestResult.text.length) {
      console.warn(
        `⚠️ Using RSS feed content as last resort (${rssText.length} chars)`,
      )
      bestResult = {
        text: rssText,
        title: rssTitle,
        excerpt: '',
        method: 'rss-feed',
      }
    }
  }

  if (bestResult.text.length > 0) {
    console.log(
      `📰 Best result: ${bestResult.text.length} chars via ${bestResult.method}`,
    )
  } else {
    console.error(`❌ All scraping sources failed for: ${url}`)
  }

  return { ...bestResult, html: bestHtml }
}
