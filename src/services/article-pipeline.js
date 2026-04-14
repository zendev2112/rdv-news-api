/**
 * Shared article processing pipeline.
 *
 * Single entry point for turning a URL (or pre-fetched text) into a
 * fully-processed article record with metadata, tags, embeds, and images.
 *
 * Used by:
 *   - fetch-to-airtable.js  (RSS pipeline)
 *   - api/slack/process.js   (Slack slash command)
 *   - src/routes/slack-integration.js (Express fallback)
 */

import { generateContent } from './ai-service.js'
import cheerio from 'cheerio'
import {
  fetchContent,
  extractText,
  extractImagesAsMarkdown,
} from './scraper.js'
import {
  reelaborateArticle,
  reelaborateSocialMedia,
  generateMetadata as generateMetadataPrompt,
  generateSocialMediaMetadata as generateSocialMediaMetadataPrompt,
  generateTags as generateTagsPrompt,
} from '../prompts/index.js'
import {
  extractInstagramEmbeds,
  extractFacebookEmbeds,
  extractTwitterEmbeds,
  extractYoutubeEmbeds,
} from './embeds/index.js'

// ── Utility functions ────────────────────────────────────────────────

const PROPER_NOUNS = [
  'Argentina',
  'Buenos Aires',
  'Coronel Suárez',
  'Huanguelén',
  'Facebook',
  'Instagram',
  'Twitter',
  'YouTube',
  'COVID',
  'AFA',
  'FIFA',
  'NBA',
  'ATP',
  'WTA',
]

export function toSentenceCase(text) {
  if (!text) return ''
  const words = text.trim().split(/\s+/)
  return words
    .map((word, i) => {
      const proper = PROPER_NOUNS.find(
        (n) => word.toLowerCase() === n.toLowerCase(),
      )
      if (proper) return proper
      if (i === 0)
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      return word.toLowerCase()
    })
    .join(' ')
}

export function stripMarkdown(text) {
  if (!text) return ''
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/ {2,}/g, ' ')
    .trim()
}

export function postProcessText(text) {
  if (!text) return ''
  let fixed = text
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
  fixed = fixed.replace(/\n{3,}/g, '\n\n').replace(/\n\s+\n/g, '\n\n')
  fixed = fixed.replace(/^\s*-\s+/gm, '- ')
  fixed = fixed.replace(/^\s*(\d+)\.\s+/gm, '$1. ')
  fixed = fixed.replace(/^#+\s+/gm, '## ')
  fixed = fixed.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  fixed = fixed.replace(/\t/g, ' ')
  fixed = fixed.replace(/ {2,}/g, ' ')
  fixed = fixed.trim()
  fixed = fixed.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'")
  return fixed
}

const EMOJI_RE =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1FA70}-\u{1FAFF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}]/gu

/**
 * Extract the main image from HTML meta tags (og:image, twitter:image)
 */
function extractMetaImage(html) {
  try {
    const $ = cheerio.load(html)
    const ogImage =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="og:image"]').attr('content')
    if (ogImage && ogImage.startsWith('http')) return ogImage

    const twitterImage =
      $('meta[name="twitter:image"]').attr('content') ||
      $('meta[property="twitter:image"]').attr('content')
    if (twitterImage && twitterImage.startsWith('http')) return twitterImage

    const metaImage = $('meta[itemprop="image"]').attr('content')
    if (metaImage && metaImage.startsWith('http')) return metaImage

    return null
  } catch {
    return null
  }
}

function cleanCodeBlocks(text) {
  return text
    .trim()
    .replace(/^```markdown\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function cleanFillerPhrases(text) {
  return text
    .replace(
      /\b(puntos principales|incluyen los siguientes|a continuación|destacan|cabe mencionar|cabe destacar|es importante mencionar|vale la pena señalar|en este contexto|por su parte|en ese sentido)\b/gi,
      '',
    )
    .replace(
      /\b(en resumen|en conclusión|para finalizar|para concluir|de esta manera)\b/gi,
      '',
    )
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .replace(/ {2,}/g, ' ')
    .trim()
}

export function isSocialMediaUrl(url) {
  try {
    const hostname = new URL(url).hostname
    return (
      hostname.includes('facebook.com') ||
      hostname.includes('instagram.com') ||
      hostname.includes('twitter.com') ||
      hostname.includes('x.com') ||
      hostname.includes('youtube.com') ||
      hostname.includes('youtu.be')
    )
  } catch {
    return false
  }
}

export function getSocialMediaType(url) {
  try {
    const hostname = new URL(url).hostname
    if (hostname.includes('facebook.com')) return 'fb-post'
    if (hostname.includes('instagram.com')) return 'ig-post'
    if (hostname.includes('twitter.com') || hostname.includes('x.com'))
      return 'tw-post'
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be'))
      return 'yt-video'
  } catch {}
  return ''
}

export function extractSourceName(url) {
  try {
    if (!url) return 'Unknown Source'
    const hostname = new URL(url).hostname
    let domain = hostname
      .replace(/^www\./, '')
      .replace(/^m\./, '')
      .replace(/^mobile\./, '')
      .replace(/^news\./, '')
      .replace(/^noticias\./, '')

    if (domain.includes('facebook.com')) return 'Facebook'
    if (domain.includes('instagram.com')) return 'Instagram'
    if (domain.includes('twitter.com') || domain.includes('x.com'))
      return 'Twitter'
    if (domain.includes('youtube.com') || domain.includes('youtu.be'))
      return 'YouTube'
    if (domain.includes('tiktok.com')) return 'TikTok'
    if (domain.includes('linkedin.com')) return 'LinkedIn'
    if (domain.includes('t.co')) return 'Twitter'

    domain = domain.replace(
      /\.(com|co|net|org|info|ar|mx|es|cl|pe|br|uy|py|bo|ec|ve|us|io|tv|app|web|digital|news|online|press|media|blog|site)(\.[a-z]{2,3})?$/,
      '',
    )
    const parts = domain.split('.')
    const sourceName = parts[0]

    const mapping = {
      lanacion: 'La Nación',
      eldiario: 'El Diario',
      pagina12: 'Página 12',
      larazon: 'La Razón',
      lavoz: 'La Voz',
      eleconomista: 'El Economista',
      elpais: 'El País',
      ole: 'Olé',
      ambito: 'Ámbito',
      telam: 'Télam',
      infobae: 'Infobae',
      eldestape: 'El Destape',
      cronista: 'El Cronista',
      tiempoar: 'Tiempo Argentino',
      tn: 'Todo Noticias',
      clarin: 'Clarín',
      lapoliticaonline: 'La Política Online',
    }
    if (mapping[sourceName]) return mapping[sourceName]

    return sourceName
      .split(/[-_]/)
      .map((w) =>
        w.length === 1
          ? w.toUpperCase()
          : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
      )
      .join(' ')
  } catch {
    return 'Unknown Source'
  }
}

// ── Fallback generators ──────────────────────────────────────────────

function generateFallbackMetadata(extractedText) {
  const paragraphs = extractedText
    .split(/\n+/)
    .filter((p) => p.trim().length > 30)
  const firstPara = paragraphs[0] || ''
  const secondPara = paragraphs[1] || ''

  const firstSentence =
    firstPara.split(/[.!?]/)[0]?.trim() || 'Artículo procesado'
  return {
    title: firstSentence.substring(0, 120),
    bajada: secondPara.substring(0, 200) || firstPara.substring(0, 200),
    volanta: 'Noticias',
  }
}

function generateFallbackTags(extractedText, metadata) {
  const text =
    `${metadata?.title || ''} ${metadata?.bajada || ''} ${extractedText}`.toLowerCase()
  const stopwords = [
    'para',
    'como',
    'esta',
    'esto',
    'estos',
    'sobre',
    'desde',
    'entre',
    'hasta',
    'porque',
    'también',
    'pero',
    'tiene',
    'tiene',
    'este',
    'esta',
  ]
  const words = text
    .split(/\W+/)
    .filter((w) => w.length > 3 && !stopwords.includes(w))
  const freq = {}
  words.forEach((w) => {
    freq[w] = (freq[w] || 0) + 1
  })
  const top = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
  if (top.length === 0) return 'Noticias, Actualidad'
  return top.map(([w]) => w.charAt(0).toUpperCase() + w.slice(1)).join(', ')
}

function formatTextAsFallback(text) {
  if (!text) return ''
  let formatted = text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\. /g, '.\n\n')
    .replace(/[#*_`]/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
  const paragraphs = formatted
    .split(/\n+/)
    .filter((p) => p.trim().length > 20)
    .map((p) => p.trim())
  return paragraphs.map((p) => (/[.!?]$/.test(p) ? p : p + '.')).join('\n\n')
}

// ── Core AI steps ────────────────────────────────────────────────────

async function reelaborateText(
  extractedText,
  imageMarkdown,
  isSocial,
  item,
  sourceName,
) {
  try {
    const prompt = isSocial
      ? reelaborateSocialMedia(
          extractedText,
          item || { url: '', title: '', content_text: extractedText },
          sourceName || '',
        )
      : reelaborateArticle(
          imageMarkdown
            ? `${extractedText}\n\n${imageMarkdown}`
            : extractedText,
        )

    const result = await generateContent(prompt, { maxTokens: 8192 })
    if (!result.text) return formatTextAsFallback(extractedText)

    let processedText = cleanCodeBlocks(result.text)

    if (isSocial) {
      processedText = processedText.replace(EMOJI_RE, '')
      processedText = processedText.replace(
        /\b(según publicó|compartió en|posteó en|difundió en|anunció en|publicó en)\s+(Facebook|Instagram|Twitter|YouTube|redes sociales|la plataforma|su cuenta)\b/gi,
        '',
      )
    }

    const wordCount = processedText
      .split(/\s+/)
      .filter((w) => w.length > 0).length
    if (wordCount < 80) return formatTextAsFallback(extractedText)
    if (isSocial && wordCount > 600) {
      processedText = processedText.split(/\s+/).slice(0, 500).join(' ')
    }

    processedText = cleanFillerPhrases(processedText)
    return postProcessText(processedText)
  } catch (error) {
    console.error('Error reelaborating text:', error.message)
    return formatTextAsFallback(extractedText)
  }
}

async function generateArticleMetadata(
  extractedText,
  isSocial,
  sourceName,
  item,
) {
  try {
    const prompt = isSocial
      ? generateSocialMediaMetadataPrompt(extractedText)
      : generateMetadataPrompt(extractedText)

    const result = await generateContent(prompt)
    if (!result.text) throw new Error('Empty AI response')

    let cleanedText = cleanCodeBlocks(result.text)

    // Remove markdown code blocks
    cleanedText = cleanedText
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim()

    const startIdx = cleanedText.indexOf('{')
    const endIdx = cleanedText.lastIndexOf('}')
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx)
      throw new Error('No JSON found')

    const jsonStr = cleanedText
      .substring(startIdx, endIdx + 1)
      .replace(/,\s*}/g, '}')
      .replace(/\n/g, ' ')
      .replace(/\r/g, '')
      .replace(/\t/g, ' ')

    let parsed
    try {
      parsed = JSON.parse(jsonStr)
    } catch (parseError) {
      console.error('JSON parse error:', parseError.message)
      console.error('Raw text:', cleanedText.substring(0, 300))
      throw new Error('Invalid JSON format')
    }

    if (!parsed.title || !parsed.bajada || !parsed.volanta)
      throw new Error('Missing fields')

    // Clean metadata fields
    parsed.title = stripMarkdown(parsed.title).replace(EMOJI_RE, '')
    parsed.bajada = stripMarkdown(parsed.bajada).replace(EMOJI_RE, '')
    parsed.volanta = stripMarkdown(parsed.volanta).replace(EMOJI_RE, '')

    if (isSocial) {
      parsed.title = toSentenceCase(parsed.title)
      parsed.volanta = toSentenceCase(parsed.volanta)
      const volantaWords = parsed.volanta.split(/\s+/)
      if (volantaWords.length > 4)
        parsed.volanta = volantaWords.slice(0, 4).join(' ')
    }

    return parsed
  } catch (error) {
    console.error('Error generating metadata:', error.message)
    return generateFallbackMetadata(extractedText)
  }
}

async function generateArticleTags(extractedText, metadata) {
  try {
    const prompt = generateTagsPrompt(extractedText, metadata)
    const result = await generateContent(prompt)
    if (!result.text) throw new Error('Empty AI response')

    const cleanedText = cleanCodeBlocks(result.text)
    const jsonMatch = cleanedText.match(/\[[\s\S]*?\]/)
    if (!jsonMatch) throw new Error('No JSON array found')

    const tags = JSON.parse(jsonMatch[0])
    if (!Array.isArray(tags) || tags.length === 0)
      throw new Error('Invalid tags')

    return tags
      .map((tag) =>
        tag
          .split(' ')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' '),
      )
      .join(', ')
  } catch (error) {
    console.error('Error generating tags:', error.message)
    return generateFallbackTags(extractedText, metadata)
  }
}

// ── Main pipeline ────────────────────────────────────────────────────

/**
 * Process a URL into a fully-formed article record.
 *
 * @param {string} url - The article URL
 * @param {Object} [options]
 * @param {string} [options.html]        - Pre-fetched HTML (skips fetch if provided)
 * @param {string} [options.extractedText] - Pre-extracted text (skips extraction if provided)
 * @param {Object} [options.item]        - RSS item with content_text, content_html, etc.
 * @param {string} [options.sourceName]  - Override auto-detected source name
 * @returns {Promise<Object|null>} Processed record fields or null if content insufficient
 */
export async function processArticleFromUrl(url, options = {}) {
  const isSocial = isSocialMediaUrl(url)
  const sourceName = options.sourceName || extractSourceName(url)

  // ── 1. Scrape ──────────────────────────────────────────────────────
  let html = options.html || ''
  let text = options.extractedText || ''
  let images = []
  let imageMarkdown = ''

  if (!html && !text) {
    html = await fetchContent(url)
  }
  if (html && !text) {
    const extracted = extractText(html)
    text = extracted.text
  }
  if (html) {
    const imgResult = extractImagesAsMarkdown(html)
    images = imgResult.images
    imageMarkdown = imgResult.markdown

    // Fallback: extract og:image / twitter:image from meta tags
    if (images.length === 0) {
      const metaImage = extractMetaImage(html)
      if (metaImage) {
        images = [metaImage]
      }
    }
  }

  if (!text || text.length < 50) return null

  // ── 2. Extract embeds ──────────────────────────────────────────────
  let instagramContent = ''
  let facebookContent = ''
  let twitterContent = ''
  let youtubeContent = ''
  if (html) {
    instagramContent = extractInstagramEmbeds(html)
    facebookContent = extractFacebookEmbeds(html)
    twitterContent = extractTwitterEmbeds(html)
    youtubeContent = extractYoutubeEmbeds(html)
  }

  // ── 3. AI: article → metadata → tags (sequential to avoid rate limits) ──
  const item = options.item || { url, title: '', content_text: text }

  const article = await reelaborateText(
    text,
    imageMarkdown,
    isSocial,
    item,
    sourceName,
  )

  const metadata = await generateArticleMetadata(
    text,
    isSocial,
    sourceName,
    item,
  )

  // For social media, use richer context for tags (metadata + article)
  const tagText = isSocial
    ? `${metadata.title} ${metadata.bajada} ${article}`
    : text
  const tags = await generateArticleTags(tagText, metadata)

  // ── 4. Build record fields ─────────────────────────────────────────
  // Image attachments with fallback chain (matching RSS pipeline)
  let imageAttachments = []
  if (images.length > 0) {
    imageAttachments = images.map((imgUrl) => ({ url: imgUrl }))
  } else if (options.item?.image) {
    imageAttachments = [{ url: options.item.image }]
    images = [options.item.image]
  } else if (options.item?.attachments?.length > 0) {
    const attachUrl = options.item.attachments[0].url
    if (attachUrl) {
      imageAttachments = [{ url: attachUrl }]
      images = [attachUrl]
    }
  }

  const fields = {
    title: stripMarkdown(metadata.title || ''),
    overline: stripMarkdown(metadata.volanta || ''),
    excerpt: stripMarkdown(metadata.bajada || ''),
    article,
    image: imageAttachments,
    imgUrl: images.length > 0 ? images[0] : '',
    'article-images': images.slice(1).join(', '),
    url,
    source: sourceName,
    'ig-post': instagramContent || '',
    'fb-post': facebookContent || '',
    'tw-post': twitterContent || '',
    'yt-video': youtubeContent || '',
    status: 'draft',
    tags,
  }

  // Set social media type field to the URL
  const socialType = getSocialMediaType(url)
  if (socialType) fields[socialType] = url

  return fields
}
