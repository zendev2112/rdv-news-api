/**
 * Test Puppeteer fetching with REAL URLs from the actual RSS feeds this app uses.
 */
import puppeteer from 'puppeteer'
import axios from 'axios'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import * as scraper from './src/services/scraper.js'
import config from './src/config/index.js'

function quickExtract(html) {
  if (!html || html.length < 100) return { len: 0, method: 'none' }
  const jsonLd = scraper.extractFromJsonLd(html)
  if (jsonLd && jsonLd.text.length > 200)
    return { len: jsonLd.text.length, method: 'json-ld' }
  try {
    const dom = new JSDOM(html, { url: 'https://example.com' })
    const article = new Readability(dom.window.document).parse()
    if (
      article &&
      article.textContent &&
      article.textContent.trim().length > 100
    ) {
      return { len: article.textContent.trim().length, method: 'readability' }
    }
  } catch {}
  return { len: 0, method: 'failed' }
}

async function main() {
  // Grab real URLs from the primera-plana feed
  const section = config.sections.find((s) => s.id === 'primera-plana')
  console.log(`Fetching feed: ${section.name} (${section.rssUrl})`)
  const feedResp = await axios.get(section.rssUrl, { timeout: 20000 })
  const items = feedResp.data.items.slice(0, 8)
  console.log(`Got ${items.length} items from feed\n`)

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  })

  let axiosWins = 0,
    puppeteerWins = 0,
    similar = 0

  for (const item of items) {
    const url = item.url
    const domain = new URL(url).hostname.replace('www.', '')
    console.log(`─── ${domain}: ${(item.title || '').substring(0, 60)} ───`)
    console.log(`  URL: ${url}`)

    // axios
    let axiosLen = 0,
      axiosMethod = 'failed'
    try {
      const resp = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Referer: 'https://www.google.com/',
        },
        responseType: 'text',
        transformResponse: [(data) => data],
        validateStatus: () => true,
      })
      if (resp.status === 200 && resp.data) {
        const r = quickExtract(resp.data)
        axiosLen = r.len
        axiosMethod = r.method
      } else {
        axiosMethod = `http-${resp.status}`
      }
    } catch (e) {
      axiosMethod = `err: ${e.message.substring(0, 30)}`
    }

    // puppeteer
    let puppeteerLen = 0,
      puppeteerMethod = 'failed'
    try {
      const page = await browser.newPage()
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      )
      await page.setRequestInterception(true)
      page.on('request', (req) => {
        if (['image', 'font', 'media'].includes(req.resourceType())) {
          req.abort()
        } else {
          req.continue()
        }
      })
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
      // Wait a bit for lazy content
      await new Promise((r) => setTimeout(r, 2000))
      const html = await page.content()
      await page.close()
      const r = quickExtract(html)
      puppeteerLen = r.len
      puppeteerMethod = r.method
    } catch (e) {
      puppeteerMethod = `err: ${e.message.substring(0, 30)}`
    }

    const diff = puppeteerLen - axiosLen
    const tag =
      diff > 300 ? '🔴 PUPPETEER' : diff < -300 ? '🟢 AXIOS' : '🟡 SIMILAR'
    console.log(
      `  axios: ${axiosLen} chars (${axiosMethod}) | puppeteer: ${puppeteerLen} chars (${puppeteerMethod}) | ${tag}`,
    )

    if (diff > 300) puppeteerWins++
    else if (diff < -300) axiosWins++
    else similar++
    console.log()
  }

  await browser.close()
  console.log(
    `\n=== SUMMARY: axios wins: ${axiosWins} | puppeteer wins: ${puppeteerWins} | similar: ${similar} ===`,
  )
}

main().catch(console.error)
