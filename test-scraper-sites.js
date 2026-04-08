/**
 * Test the improved scraper against real Argentine news sites
 */
import * as scraper from './src/services/scraper.js'
import * as cheerio from 'cheerio'

async function testUrl(name, url) {
  console.log(`\n=== Testing ${name} ===`)
  console.log(`URL: ${url}`)

  const html = await scraper.fetchContent(url, { timeout: 20000 })
  if (!html) {
    console.log('❌ Failed to fetch HTML')
    return null
  }

  console.log(`HTML length: ${html.length}`)

  const result = scraper.extractText(html)
  console.log(`Method: ${result.method}`)
  console.log(`Text length: ${result.text.length}`)
  if (result.title) console.log(`Title: ${result.title.substring(0, 120)}`)
  if (result.excerpt)
    console.log(`Excerpt: ${result.excerpt.substring(0, 200)}`)
  console.log(`First 500 chars:\n${result.text.substring(0, 500)}`)
  console.log(`...`)
  console.log(
    `Last 300 chars:\n${result.text.substring(result.text.length - 300)}`,
  )

  return result
}

async function findArticleUrl(siteUrl, pathPattern) {
  const html = await scraper.fetchContent(siteUrl, { timeout: 20000 })
  if (!html) return null

  const $ = cheerio.load(html)
  const links = new Set()

  $('a').each(function () {
    const href = $(this).attr('href')
    if (href && href.includes(pathPattern) && href.includes('202')) {
      const fullUrl = href.startsWith('http')
        ? href
        : new URL(href, siteUrl).href
      links.add(fullUrl)
    }
  })

  const linkArray = [...links]
  console.log(`Found ${linkArray.length} article links from ${siteUrl}`)
  return linkArray[0] || null
}

async function testDiagnostic(name, url) {
  console.log(`\n=== Diagnostic: ${name} ===`)
  const html = await scraper.fetchContent(url, { timeout: 20000 })
  if (!html) {
    console.log('❌ Could not fetch HTML at all')
    return
  }
  console.log(`HTML length: ${html.length}`)
  console.log(`Has JSON-LD: ${html.includes('application/ld+json')}`)
  console.log(`Has __NEXT_DATA__: ${html.includes('__NEXT_DATA__')}`)

  // Check what JSON-LD contains
  const $ = cheerio.load(html)
  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      const data = JSON.parse($(el).html())
      const schemas = Array.isArray(data) ? data : [data]
      for (const s of schemas) {
        const type = s['@type'] || 'unknown'
        const hasBody = !!(s.articleBody || s.text)
        const bodyLen = (s.articleBody || s.text || '').length
        console.log(
          `  JSON-LD schema: ${type}, hasBody: ${hasBody}, bodyLength: ${bodyLen}`,
        )
      }
    } catch {}
  })

  const result = scraper.extractText(html)
  console.log(`Extraction method: ${result.method}`)
  console.log(`Text length: ${result.text.length}`)
  console.log(`Title: ${(result.title || '').substring(0, 100)}`)
  console.log(`First 300 chars: ${result.text.substring(0, 300)}`)
  return result
}

async function main() {
  console.log('Testing improved scraper with real Argentine news sites\n')

  // Test Infobae - find a real article
  console.log('--- Finding Infobae article ---')
  const infobaeArticle = await findArticleUrl('https://www.infobae.com', '/202')
  if (infobaeArticle) {
    await testUrl('Infobae', infobaeArticle)
  } else {
    console.log('Could not find Infobae article URL')
  }

  // Test Clarin - find a real article
  console.log('\n--- Finding Clarin article ---')
  const clarinArticle = await findArticleUrl('https://www.clarin.com', '/202')
  if (clarinArticle) {
    await testUrl('Clarin', clarinArticle)
  } else {
    console.log('Could not find Clarin article URL')
  }

  // Test La Nacion
  console.log('\n--- Finding La Nacion article ---')
  const nacionArticle = await findArticleUrl(
    'https://www.lanacion.com.ar',
    '/202',
  )
  if (nacionArticle) {
    await testUrl('La Nacion', nacionArticle)
  } else {
    console.log('Could not find La Nacion article URL')
  }

  // Test content_html extraction
  console.log('\n\n=== Testing content_html extraction ===')
  const sampleHtml = `
    <div>
      <p>Este es un comunicado institucional de la Municipalidad de Pigüé sobre el nuevo programa de desarrollo urbano.</p>
      <p>El intendente anunció que se invertirán más de 50 millones de pesos en obras de infraestructura para mejorar la calidad de vida de los vecinos.</p>
      <p>Las obras incluyen pavimentación de calles, mejoras en el sistema de agua potable y la construcción de nuevos espacios verdes.</p>
    </div>
  `
  const extracted = scraper.extractFromContentHtml(sampleHtml)
  console.log(`Extracted from content_html (${extracted.length} chars):`)
  console.log(extracted)

  // Diagnostic tests for problematic sites
  console.log('\n\n=== COMPREHENSIVE SCRAPING: scrapeArticle() ===')

  // Test scrapeArticle end-to-end with various sites
  const testSites = [
    { name: 'Diario de Rivera', homepage: 'https://www.diarioderivera.com.ar' },
    { name: 'Infobae', homepage: 'https://www.infobae.com' },
  ]

  for (const site of testSites) {
    console.log(`\n--- ${site.name} ---`)
    const articleUrl = await findArticleUrl(site.homepage, '/')
    if (articleUrl) {
      console.log(`Article: ${articleUrl}`)
      const result = await scraper.scrapeArticle(articleUrl, {
        rssContentText: 'Fallback RSS content for testing purposes only.',
        rssContentHtml:
          '<p>Fallback RSS content for testing purposes only.</p>',
        rssTitle: 'Test Title',
      })
      console.log(`Method: ${result.method}`)
      console.log(`Text length: ${result.text.length}`)
      console.log(`Has HTML: ${!!result.html}`)
      console.log(`Title: ${(result.title || '').substring(0, 100)}`)
      console.log(`First 400 chars: ${result.text.substring(0, 400)}`)
    } else {
      console.log('Could not find article URL')
    }
  }
}
main().catch(console.error)
