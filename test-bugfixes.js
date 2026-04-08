/**
 * Test script to verify the three bug fixes in fetch-to-airtable.js
 *
 * Bug 1: Missing `return` in social media processing (caused double processing)
 * Bug 2: Dead `fetchFeed` and `fetchSourceItems` functions (referenced undefined vars)
 * Bug 3: Duplicate `processAllRequestedSections()` calls (caused parallel double execution)
 *
 * Run: node test-bugfixes.js
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const source = fs.readFileSync(
  path.join(__dirname, 'fetch-to-airtable.js'),
  'utf8',
)

let passed = 0
let failed = 0

function test(name, condition, detail) {
  if (condition) {
    console.log(`  ✅ PASS: ${name}`)
    passed++
  } else {
    console.log(`  ❌ FAIL: ${name}`)
    if (detail) console.log(`          ${detail}`)
    failed++
  }
}

console.log('\n=== Bug Fix Verification Tests ===\n')

// ────────────────────────────────────────────────────────
// BUG 1: Missing return in social media processing
// ────────────────────────────────────────────────────────
console.log(
  'Bug 1: Social media processing must return before regular processing',
)

// Check that after the social media if-block, there is a `return` before the closing `}`
// The pattern we expect:
//   } catch (error) { ... }
//   return    <-- THIS MUST EXIST
//   }
//   // Load state for this section  <-- regular processing starts here

// Simple check: after "Social media processing complete" comment, there must be a return before the next function body
const returnBeforeRegularProcessing =
  source.includes('// Social media processing complete') &&
  source.includes('return\n  }\n\n  // Load state for this section')
test(
  'return statement exists after social media try/catch',
  returnBeforeRegularProcessing,
  'Expected: return statement before closing } of social media if-block',
)

// Double check: the comment "If we reach here, something went wrong" should be GONE
test(
  'misleading comment removed',
  !source.includes('If we reach here, something went wrong'),
  'The old misleading comment should have been replaced',
)

// ────────────────────────────────────────────────────────
// BUG 2: Dead code removed
// ────────────────────────────────────────────────────────
console.log('\nBug 2: Dead fetchFeed/fetchSourceItems functions removed')

test(
  'fetchFeed function removed',
  !source.includes('async function fetchFeed('),
  'fetchFeed was dead code referencing undefined `items` variable',
)

test(
  'fetchSourceItems function removed',
  !source.includes('async function fetchSourceItems('),
  'fetchSourceItems was dead code with incomplete body',
)

test(
  '"Look for a function like fetchFeed" comment removed',
  !source.includes('Look for a function like fetchFeed'),
  'Scaffolding comment should be removed',
)

// ────────────────────────────────────────────────────────
// BUG 3: Duplicate execution blocks removed
// ────────────────────────────────────────────────────────
console.log('\nBug 3: Duplicate processAllRequestedSections() calls removed')

// Count how many times processAllRequestedSections() is CALLED (not defined)
const callMatches = source.match(/processAllRequestedSections\(\)/g) || []
// One is the function definition, the rest are calls
const definitionCount = (
  source.match(/async function processAllRequestedSections\(\)/g) || []
).length
const callCount = callMatches.length - definitionCount

test(
  `processAllRequestedSections() called exactly 1 time (found: ${callCount})`,
  callCount === 1,
  'Should have exactly one call at the end of the file',
)

// The duplicate `if (args.all)` block at the bottom should be gone
// The original arg parsing at the top (lines ~85-117 setting sectionsToProcess) should remain
// But there should NOT be a second `if (args.all)` block with `process.exit(0)` and `await processSection`
const argsAllWithProcessExit = source.match(
  /if \(args\.all\) \{[^}]*process\.exit\(0\)/gs,
)
test(
  'duplicate if(args.all) with process.exit(0) removed',
  !argsAllWithProcessExit,
  'The bottom-of-file duplicate args.all block should be removed',
)

// Check there's no `const sectionName = args._[0]` followed by process.exit
const sectionNameBlock = source.match(
  /const sectionName = args\._\[0\]\s*\nif \(sectionName\)/gs,
)
test(
  'duplicate sectionName block removed',
  !sectionNameBlock,
  'The bottom-of-file duplicate sectionName block should be removed',
)

// The final call should include printUsageReport
const finalCall = source.match(
  /processAllRequestedSections\(\)\s*\.then\(\(\) => \{[^}]*printUsageReport/s,
)
test(
  'final call includes printUsageReport()',
  !!finalCall,
  'The single remaining call should print the usage report',
)

// ────────────────────────────────────────────────────────
// STRUCTURAL INTEGRITY CHECKS
// ────────────────────────────────────────────────────────
console.log('\nStructural integrity checks')

// Make sure processSection is still defined
test(
  'processSection function exists',
  source.includes('async function processSection(section)'),
)

// Make sure processAllRequestedSections is still defined
test(
  'processAllRequestedSections function exists',
  source.includes('async function processAllRequestedSections()'),
)

// Make sure processBatch is still defined
test(
  'processBatch function exists',
  source.includes('async function processBatch('),
)

// Make sure processArticle is still defined
test(
  'processArticle function exists',
  source.includes('async function processArticle('),
)

// Make sure the social media sections are still detected
const socialSections = [
  'instituciones',
  'local-facebook',
  'huanguelen',
  'pueblos-alemanes',
]
for (const sid of socialSections) {
  test(
    `social media section '${sid}' still handled`,
    source.includes(`section.id === '${sid}'`),
  )
}

// Make sure sectionsToProcess is still set at the top
test(
  'sectionsToProcess initialized at top of file',
  source.includes('let sectionsToProcess = []'),
)

// Make sure airtable insert is still called
test(
  'airtableService.insertRecords still present',
  source.includes('airtableService.insertRecords'),
)

// ────────────────────────────────────────────────────────
// PROMPTS EXTRACTION CHECKS
// ────────────────────────────────────────────────────────
console.log('\nPrompts extraction checks')

// Verify prompts module exists and exports functions
const promptsSource = fs.readFileSync(
  path.join(__dirname, 'src/prompts/index.js'),
  'utf8',
)

test(
  'prompts module has reelaborateArticle',
  promptsSource.includes('export function reelaborateArticle('),
)
test(
  'prompts module has reelaborateSocialMedia',
  promptsSource.includes('export function reelaborateSocialMedia('),
)
test(
  'prompts module has generateMetadata',
  promptsSource.includes('export function generateMetadata('),
)
test(
  'prompts module has generateSocialMediaMetadata',
  promptsSource.includes('export function generateSocialMediaMetadata('),
)
test(
  'prompts module has generateTags',
  promptsSource.includes('export function generateTags('),
)

// Verify fetch-to-airtable imports the new modules
test(
  'imports prompts module',
  source.includes("import * as prompts from './src/prompts/index.js'"),
)
test(
  'imports scraper module',
  source.includes("import * as scraper from './src/services/scraper.js'"),
)

// Verify inline prompts were removed (no more giant template literals with TEXTO ORIGINAL)
test(
  'inline reelaborate prompt removed from main file',
  !source.includes('REGLAS OBLIGATORIAS (SI NO SE CUMPLEN TODAS'),
)
test(
  'inline social media prompt removed from main file',
  !source.includes(
    'OBJETIVO CRÍTICO: Crear un artículo periodístico de 350-500',
  ),
)
test(
  'inline metadata prompt removed (CAMPO 1)',
  !source.includes('CAMPO 1 - title (título)'),
)
test(
  'inline tags prompt removed',
  !source.includes('Analiza este artículo y genera entre 5 y 8 etiquetas'),
)

// Verify prompts.X() calls are used instead
test(
  'uses prompts.reelaborateArticle()',
  source.includes('prompts.reelaborateArticle('),
)
test(
  'uses prompts.reelaborateSocialMedia()',
  source.includes('prompts.reelaborateSocialMedia('),
)
test(
  'uses prompts.generateMetadata()',
  source.includes('prompts.generateMetadata('),
)
test(
  'uses prompts.generateSocialMediaMetadata()',
  source.includes('prompts.generateSocialMediaMetadata('),
)
test('uses prompts.generateTags()', source.includes('prompts.generateTags('))

// ────────────────────────────────────────────────────────
// SCRAPER MODULE CHECKS
// ────────────────────────────────────────────────────────
console.log('\nScraper module checks')

const scraperSource = fs.readFileSync(
  path.join(__dirname, 'src/services/scraper.js'),
  'utf8',
)

test(
  'scraper exports fetchContent',
  scraperSource.includes('export async function fetchContent('),
)
test(
  'scraper exports extractText',
  scraperSource.includes('export function extractText('),
)
test(
  'scraper exports extractImagesAsMarkdown',
  scraperSource.includes('export function extractImagesAsMarkdown('),
)
test(
  'scraper has pre-clean HTML step',
  scraperSource.includes('export function preCleanHtml('),
)
test(
  'scraper has Readability extraction',
  scraperSource.includes('export function extractWithReadability('),
)
test(
  'scraper has CSS selector fallback',
  scraperSource.includes('export function extractWithSelectors('),
)
test('scraper has retry logic', scraperSource.includes('maxRetries'))
test(
  'scraper has Argentine news selectors',
  scraperSource.includes('nota-cuerpo') ||
    scraperSource.includes('cuerpo-nota'),
)

// New anti-cropping features
test(
  'scraper has JSON-LD extraction',
  scraperSource.includes('export function extractFromJsonLd('),
)
test(
  'scraper has __NEXT_DATA__ extraction',
  scraperSource.includes('export function extractFromNextData('),
)
test(
  'scraper has content_html extraction',
  scraperSource.includes('export function extractFromContentHtml('),
)
test(
  'scraper uses Google referrer for paywalls',
  scraperSource.includes("Referer: 'https://www.google.com/'"),
)
test(
  'scraper has paywall domain list',
  scraperSource.includes('PAYWALL_DOMAINS') &&
    scraperSource.includes('clarin.com'),
)
test(
  'extractText tries JSON-LD first',
  scraperSource.includes("method: 'json-ld'"),
)
test(
  'extractText tries __NEXT_DATA__ second',
  scraperSource.includes("method: 'next-data'"),
)
test(
  'scraper has Infobae-specific selectors',
  scraperSource.includes('article-body-content') ||
    scraperSource.includes('article-story-content'),
)
test(
  'scraper has Clarin-specific selectors',
  scraperSource.includes('#nota-body-text') ||
    scraperSource.includes('.nota-txt'),
)

// Social media content_html fallback
test(
  'social media uses content_html fallback',
  source.includes('extractFromContentHtml') && source.includes('content_html'),
)

// Verify old inline functions are replaced with scraper delegates
test(
  'fetchContent delegates to scraper',
  source.includes('scraper.fetchContent('),
)
test(
  'extractText delegates to scraper',
  source.includes('scraper.extractText('),
)
test(
  'extractImagesAsMarkdown delegates to scraper',
  source.includes('scraper.extractImagesAsMarkdown('),
)

// ────────────────────────────────────────────────────────
// COMPREHENSIVE SCRAPING (anti-cropping) CHECKS
// ────────────────────────────────────────────────────────
console.log('\nComprehensive scraping checks')

test(
  'scraper exports scrapeArticle',
  scraperSource.includes('export async function scrapeArticle('),
)
test(
  'scraper exports fetchGoogleCache',
  scraperSource.includes('export async function fetchGoogleCache('),
)
test(
  'scraper exports fetchAmpVersion',
  scraperSource.includes('export async function fetchAmpVersion('),
)
test(
  'scrapeArticle tries AMP fallback',
  scraperSource.includes('fetchAmpVersion(url'),
)
test(
  'scrapeArticle tries Google Cache fallback',
  scraperSource.includes('fetchGoogleCache(url'),
)
test(
  'scrapeArticle uses RSS content as last resort',
  scraperSource.includes('rss-feed') &&
    scraperSource.includes('rssContentText'),
)
test(
  'scrapeArticle has MIN_QUALITY_CHARS threshold',
  scraperSource.includes('MIN_QUALITY_CHARS'),
)
test(
  'processArticle uses scraper.scrapeArticle',
  source.includes('scraper.scrapeArticle('),
)
test(
  'processArticle passes RSS content to scrapeArticle',
  source.includes('rssContentText') && source.includes('rssContentHtml'),
)

// ────────────────────────────────────────────────────────
// RESULTS
// ────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`)
console.log(
  `Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`,
)
console.log(`${'='.repeat(50)}\n`)

if (failed > 0) {
  process.exit(1)
} else {
  console.log('All bug fixes verified successfully!\n')
  process.exit(0)
}
