/**
 * ROOT CAUSE PROOF: Compare axios (static HTML) vs Puppeteer (real browser)
 * for content extraction from the same URLs.
 */
import axios from 'axios'
import puppeteer from 'puppeteer'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import * as scraper from './src/services/scraper.js'

function quickExtract(html) {
  if (!html || html.length < 100) return { text: '', method: 'none', len: 0 }
  // Try JSON-LD first
  const jsonLd = scraper.extractFromJsonLd(html)
  if (jsonLd && jsonLd.text.length > 200)
    return { text: jsonLd.text, method: 'json-ld', len: jsonLd.text.length }
  // Then Readability
  try {
    const dom = new JSDOM(html, { url: 'https://example.com' })
    const article = new Readability(dom.window.document).parse()
    if (
      article &&
      article.textContent &&
      article.textContent.trim().length > 100
    ) {
      return {
        text: article.textContent.trim(),
        method: 'readability',
        len: article.textContent.trim().length,
      }
    }
  } catch {}
  return { text: '', method: 'failed', len: 0 }
}

// Test URLs — real articles from the user's problem sites
const TEST_URLS = [
  'https://www.clarin.com/politica/milei-confirmo-arancel-retorsion-contra-estados-unidos-dijo-negociacion-bilateral_0_l5Fhj5oJ4y.html',
  'https://www.eldestapeweb.com/politica/gobierno/el-fmi-insiste-en-que-milei-devalua-y-le-pone-fecha-2025-4-7-12-20-0/',
  'https://www.nationalgeographic.com.es/ciencia/nuevos-estudios-revelan-que-marte-tuvo-condiciones-habitables-mucho-mas-tiempo-del-pensado_23456',
  'https://www.diarioderivera.com.ar/2026/04/07/nueva-jornada-gratuita-de-castracion-de-perros-y-gatos-en-rivera-2/',
  'https://www.labrujula24.com/notas/2026/04/08/el-hospital-municipal-renueva-su-compromiso-con-la-salud-de-los-ninos',
]

async function main() {
  console.log('=== ROOT CAUSE: axios vs Puppeteer comparison ===\n')

  // Launch browser once
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  })

  for (const url of TEST_URLS) {
    console.log(`\n─── ${url.substring(0, 80)}... ───`)

    // Method A: axios (what we currently use)
    let axiosLen = 0
    let axiosMethod = 'failed'
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
      }
    } catch (e) {
      axiosMethod = `error: ${e.message.substring(0, 40)}`
    }

    // Method B: Puppeteer (real browser)
    let puppeteerLen = 0
    let puppeteerMethod = 'failed'
    try {
      const page = await browser.newPage()
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      )
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-AR,es;q=0.9' })
      // Block images/fonts/media to speed things up
      await page.setRequestInterception(true)
      page.on('request', (req) => {
        if (
          ['image', 'font', 'media', 'stylesheet'].includes(req.resourceType())
        ) {
          req.abort()
        } else {
          req.continue()
        }
      })
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
      const html = await page.content()
      await page.close()

      const r = quickExtract(html)
      puppeteerLen = r.len
      puppeteerMethod = r.method
    } catch (e) {
      puppeteerMethod = `error: ${e.message.substring(0, 40)}`
    }

    const diff = puppeteerLen - axiosLen
    const indicator =
      diff > 200
        ? '🔴 PUPPETEER WINS'
        : diff < -200
          ? '🟢 AXIOS WINS'
          : '🟡 SIMILAR'

    console.log(
      `  axios:     ${axiosLen.toString().padStart(6)} chars (${axiosMethod})`,
    )
    console.log(
      `  puppeteer: ${puppeteerLen.toString().padStart(6)} chars (${puppeteerMethod})`,
    )
    console.log(`  ${indicator} (diff: ${diff > 0 ? '+' : ''}${diff})`)
  }

  await browser.close()
  console.log('\n=== Done ===')
}

main().catch(console.error)
