import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Create __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create screenshots directory
const SCREENSHOTS_DIR = path.join(__dirname, '../../temp/screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

/**
 * Simple delay function
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Scrape content from a social media URL
 * @param {string} url - Social media post URL
 * @param {object} options - Scraping options
 * @returns {Promise<object>} - Scraped content
 */
async function scrapeUrl(url, options = {}) {
  const {
    takeScreenshot = true,
    waitTime = 3000,
    viewport = { width: 1280, height: 800 }
  } = options;

  console.log(`Scraping URL: ${url}`);
  
  let browser = null;
  
  try {
    // Launch browser
    browser = await puppeteer.launch({
      headless: 'new', // Use new headless mode
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setViewport(viewport);
    
    // Set user agent to avoid blocking
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Navigate to the URL
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for content to load - using delay instead of waitForTimeout
    await delay(waitTime);
    
    // Determine platform
    const platform = getPlatformFromUrl(url);
    
    // Take screenshot if enabled
    let screenshotPath = null;
    if (takeScreenshot) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      screenshotPath = path.join(SCREENSHOTS_DIR, `${platform}-${timestamp}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Screenshot saved: ${screenshotPath}`);
    }
    
    // Extract content based on platform
    let content = null;
    
    if (platform === 'facebook') {
      content = await extractFacebookContent(page);
    } else if (platform === 'instagram') {
      content = await extractInstagramContent(page);
    } else {
      // Generic extraction
      content = await extractGenericContent(page);
    }
    
    // Close browser
    await browser.close();
    browser = null;
    
    return {
      url,
      platform,
      screenshot: screenshotPath,
      timestamp: new Date().toISOString(),
      content
    };
    
  } catch (error) {
    console.error(`Scraping error: ${error.message}`);
    
    if (browser) {
      await browser.close();
    }
    
    return {
      url,
      platform: getPlatformFromUrl(url),
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Determine platform from URL
 * @param {string} url - Social media URL
 * @returns {string} - Platform name
 */
function getPlatformFromUrl(url) {
  if (url.includes('facebook.com') || url.includes('fb.com')) {
    return 'facebook';
  } else if (url.includes('instagram.com')) {
    return 'instagram';
  } else if (url.includes('twitter.com') || url.includes('x.com')) {
    return 'twitter';
  } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
    return 'youtube';
  }
  return 'unknown';
}

/**
 * Extract content from Facebook posts
 * @param {object} page - Puppeteer page
 * @returns {Promise<object>} - Extracted content
 */
async function extractFacebookContent(page) {
  try {
    // Wait for main content to load
    try {
      await page.waitForSelector('div[data-pagelet="FeedUnit"]', { timeout: 5000 });
    } catch (e) {
      console.log('Facebook feed unit not found, continuing...');
    }
    
    const content = await page.evaluate(() => {
      // Try different selectors to find post content
      const selectors = [
        // Post text content
        '.userContent',
        'div[data-ad-preview="message"]',
        'div.xdj266r',
        'div[data-testid="post_message"]',
        // Modern Facebook
        'div.x1iorvi4 span',
        // Generic content
        'article, [role="article"]'
      ];
      
      let postText = '';
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          for (const el of elements) {
            postText += el.innerText + '\n';
          }
          if (postText.trim()) break;
        }
      }
      
      // Get author/page name
      const authorSelectors = [
        'h3.x1heor9g', 
        'a.x1i10hfl[href*="/"]',
        'a[aria-label]',
        'h2 a',
        'a.profileLink',
        'span.fwb a'
      ];
      
      let author = '';
      for (const selector of authorSelectors) {
        const authorElement = document.querySelector(selector);
        if (authorElement) {
          author = authorElement.innerText || authorElement.textContent;
          if (author.trim()) break;
        }
      }
      
      // Get post date
      const dateSelectors = [
        'a.x1i10hfl span.x4k7w5x span.x1lliihq',
        'abbr',
        'a[href*="posts"] span',
        '[data-testid="story-subtitle"] a span'
      ];
      
      let date = '';
      for (const selector of dateSelectors) {
        const dateElement = document.querySelector(selector);
        if (dateElement) {
          date = dateElement.innerText || dateElement.textContent || dateElement.getAttribute('title');
          if (date) break;
        }
      }
      
      // Get images
      const images = Array.from(document.querySelectorAll('img[src*="scontent"]'))
        .map(img => img.src)
        .filter((src, index, self) => self.indexOf(src) === index) // Unique only
        .slice(0, 5); // Limit to first 5
      
      return { postText: postText.trim(), author: author.trim(), date, images };
    });
    
    return content;
  } catch (error) {
    console.error(`Facebook extraction error: ${error.message}`);
    return { error: error.message };
  }
}

/**
 * Extract content from Instagram posts
 * @param {object} page - Puppeteer page
 * @returns {Promise<object>} - Extracted content
 */
async function extractInstagramContent(page) {
  try {
    // Wait for content to load
    await delay(2000);
    
    // Deal with cookie consent if present
    try {
      const cookieButton = await page.$('button[tabindex="0"]');
      if (cookieButton) {
        await cookieButton.click();
        await delay(1000);
      }
    } catch (e) {
      // Ignore cookie errors
    }
    
    const content = await page.evaluate(() => {
      // Try different selectors for caption
      const captionSelectors = [
        // Modern Instagram
        'ul > div > li > div > div > div.x11i5rnm',
        'div._a9zr > h1',
        // Legacy Instagram 
        '.C4VMK span',
        // Generic post text
        'article div > span'
      ];
      
      let caption = '';
      for (const selector of captionSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          for (const el of elements) {
            caption += el.innerText + '\n';
          }
          if (caption.trim()) break;
        }
      }
      
      // Get username
      const userSelectors = [
        'a.x1i10hfl[href^="/"]',
        'a.sqdOP',
        'h2 a',
        '.ZUqME',
        '[data-testid="user-avatar"]'
      ];
      
      let username = '';
      for (const selector of userSelectors) {
        const userElement = document.querySelector(selector);
        if (userElement) {
          username = userElement.innerText || userElement.getAttribute('href');
          if (username && username.startsWith('/')) {
            username = username.substring(1);
          }
          if (username) break;
        }
      }
      
      // Get main image
      const mainImage = document.querySelector('img[sizes]')?.src || 
                        document.querySelector('div._aagu img')?.src || 
                        document.querySelector('article img')?.src;
      
      return { 
        caption: caption.trim(), 
        username: username.trim(),
        mainImage
      };
    });
    
    return content;
  } catch (error) {
    console.error(`Instagram extraction error: ${error.message}`);
    return { error: error.message };
  }
}

/**
 * Extract content from generic websites
 * @param {object} page - Puppeteer page
 * @returns {Promise<object>} - Extracted content
 */
async function extractGenericContent(page) {
  try {
    return await page.evaluate(() => {
      // Get page title
      const title = document.title;
      
      // Get meta description
      const metaDescription = document.querySelector('meta[name="description"]')?.content || '';
      
      // Get main content
      let mainContent = '';
      const contentSelectors = [
        'article',
        'main',
        '.post-content',
        '.entry-content',
        '#content',
        '.content'
      ];
      
      for (const selector of contentSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          mainContent = element.innerText;
          if (mainContent.length > 100) break;
        }
      }
      
      // Get images (limit to 3)
      const images = Array.from(document.querySelectorAll('img[src]'))
        .map(img => img.src)
        .filter(src => src && src.length > 10)
        .slice(0, 3);
      
      return {
        title,
        metaDescription,
        mainContent: mainContent.slice(0, 2000), // Limit length
        images
      };
    });
  } catch (error) {
    console.error(`Generic extraction error: ${error.message}`);
    return { error: error.message };
  }
}

/**
 * Main function to scrape multiple URLs
 * @param {string[]} urls - List of URLs to scrape
 * @param {object} options - Scraping options
 * @returns {Promise<object[]>} - Scraped results
 */
async function scrapeMultipleUrls(urls, options = {}) {
  const results = [];
  
  for (const url of urls) {
    try {
      const result = await scrapeUrl(url, options);
      results.push(result);
      
      // Wait between requests to avoid rate limiting
      await delay(3000);
    } catch (error) {
      console.error(`Error scraping ${url}: ${error.message}`);
      results.push({
        url,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  return results;
}

// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const urls = args.filter(arg => arg.startsWith('http'));
  const saveResults = args.includes('--save');
  
  if (urls.length === 0) {
    console.log(`
Usage: node social-media-scraper.js [options] URL1 URL2 ...

Options:
  --save    Save results to JSON file

Examples:
  node social-media-scraper.js https://www.facebook.com/example/posts/123456
  node social-media-scraper.js https://www.instagram.com/p/ABC123/ --save
    `);
    process.exit(1);
  }
  
  console.log(`
==================================
SOCIAL MEDIA SCRAPER
==================================
URLs to scrape: ${urls.length}
Save results: ${saveResults ? 'Yes' : 'No'}
  `);
  
  scrapeMultipleUrls(urls)
    .then(results => {
      console.log('\n=== SCRAPING RESULTS ===\n');
      
      for (const result of results) {
        console.log(`URL: ${result.url}`);
        console.log(`Platform: ${result.platform}`);
        
        if (result.error) {
          console.log(`Error: ${result.error}`);
        } else {
          console.log(`Content extracted: ${JSON.stringify(result.content, null, 2)}`);
          if (result.screenshot) {
            console.log(`Screenshot: ${result.screenshot}`);
          }
        }
        
        console.log('\n' + '-'.repeat(50) + '\n');
      }
      
      if (saveResults) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outputPath = path.join(__dirname, `../../temp/scrape-results-${timestamp}.json`);
        
        fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
        console.log(`Results saved to: ${outputPath}`);
      }
      
      process.exit(0);
    })
    .catch(error => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

export { scrapeUrl, scrapeMultipleUrls };