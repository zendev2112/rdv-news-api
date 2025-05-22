import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import logger from '../utils/logger.js';

// Create temp directory for images
const tempDir = path.join(os.tmpdir(), 'rdv-images');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Global browser instance
let browser = null;
let initialized = false;

/**
 * Initialize the browser instance
 */
async function initialize() {
  if (!initialized) {
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
      initialized = true;
      logger.info('Browser renderer initialized');
    } catch (error) {
      logger.error('Failed to initialize browser renderer:', error);
      throw error;
    }
  }
}

/**
 * Close browser when done
 */
async function close() {
  if (browser) {
    await browser.close();
    browser = null;
    initialized = false;
    logger.info('Browser renderer closed');
  }
}

/**
 * Render social image using puppeteer
 * @param {Object} options - Options for rendering
 * @returns {Promise<string>} - Path to generated image
 */
async function renderSocialImage({ 
  imageUrl, 
  title, 
  date, 
  width = 1200, 
  height = 628,
  platform = 'facebook' 
}) {
  await initialize();
  
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  
  // Create HTML template with proper fonts and styling
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap');
          
          body, html {
            margin: 0;
            padding: 0;
            width: ${width}px;
            height: ${height}px;
            overflow: hidden;
            font-family: 'Roboto', Arial, sans-serif;
          }
          
          .container {
            position: relative;
            width: 100%;
            height: 100%;
            background-color: #000;
          }
          
          .image {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
          }
          
          .logo {
            position: absolute;
            top: 20px;
            left: 20px;
            height: ${height * 0.1}px;
            z-index: 10;
          }
          
          .overlay {
            position: absolute;
            bottom: 0;
            left: 0;
            width: 100%;
            height: 130px;
            background: linear-gradient(transparent, rgba(0,0,0,0.8) 30%, rgba(0,0,0,0.95));
          }
          
          .title {
            position: absolute;
            bottom: 50px;
            left: 0;
            width: 100%;
            padding: 0 30px;
            box-sizing: border-box;
            font-family: 'Roboto', sans-serif;
            font-weight: 700;
            font-size: ${width * 0.045}px;
            color: #fff;
            text-align: center;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.9);
          }
          
          .date {
            position: absolute;
            bottom: 20px;
            left: 0;
            width: 100%;
            padding: 0 30px;
            box-sizing: border-box;
            font-family: 'Roboto', sans-serif;
            font-weight: 400;
            font-size: ${width * 0.03}px;
            color: #ccc;
            text-align: center;
            text-shadow: 1px 1px 3px rgba(0,0,0,0.7);
          }
        </style>
      </head>
      <body>
        <div class="container">
          <img class="image" src="${imageUrl}" alt="Background" />
          <img class="logo" src="https://radiodelvolga.ar/wp-content/uploads/2023/04/rdv-negro.png" alt="Logo" />
          <div class="overlay"></div>
          <div class="title">${title}</div>
          <div class="date">${date}</div>
        </div>
      </body>
    </html>
  `;
  
  // Navigate to blank page and set content
  await page.goto('about:blank');
  await page.setContent(html, { waitUntil: 'networkidle0' });
  
  // Wait for images to load
  await page.evaluate(() => {
    return Promise.all(
      Array.from(document.images)
        .filter(img => !img.complete)
        .map(img => new Promise(resolve => {
          img.onload = img.onerror = resolve;
        }))
    );
  });
  
  // Save screenshot
  const outputPath = path.join(tempDir, `${platform}-${Date.now()}.png`);
  await page.screenshot({ 
    path: outputPath,
    type: 'png',
    quality: 100,
    fullPage: false
  });
  
  await page.close();
  
  return outputPath;
}

export { initialize, renderSocialImage, close };