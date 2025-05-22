import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Airtable from 'airtable';
import { exec } from 'child_process';
import { promisify } from 'util';
import fetch from 'node-fetch';
import logger from '../utils/logger.js';
import sharp from 'sharp';

const router = express.Router();
const execAsync = promisify(exec);

// Ensure temp directory exists
const TEMP_DIR = path.join(os.tmpdir(), 'rdv-images');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Generate image using Sharp instead of ImageMagick
 */
async function generateFromTemplate(options) {
  const { 
    title, 
    overline = '', 
    backgroundUrl = null,
    date, 
    platform = 'facebook' 
  } = options;
  
  try {
    // Set dimensions based on platform
    let width, height;
    switch (platform.toLowerCase()) {
      case 'instagram':
        width = 1080;
        height = 1080;
        break;
      case 'twitter':
        width = 1200;
        height = 675;
        break;
      case 'facebook':
      default:
        width = 1200;
        height = 628;
    }
    
    // Create output path
    const outputPath = path.join(TEMP_DIR, `${platform}-${Date.now()}.png`);
    
    // Start with either background image or solid color
    let baseImage;
    
    if (backgroundUrl) {
      try {
        // Try to download and use background image
        const response = await fetch(backgroundUrl);
        if (response.ok) {
          const buffer = await response.buffer();
          baseImage = sharp(buffer);
        } else {
          throw new Error('Failed to download background image');
        }
      } catch (err) {
        logger.warn(`Using default background: ${err.message}`);
        // Fall back to solid color if background download fails
        baseImage = sharp({
          create: {
            width,
            height,
            channels: 4,
            background: { r: 23, g: 42, b: 136, alpha: 1 } // Dark blue
          }
        });
      }
    } else {
      // Create a solid color background if no URL provided
      baseImage = sharp({
        create: {
          width,
          height,
          channels: 4,
          background: { r: 23, g: 42, b: 136, alpha: 1 } // Dark blue
        }
      });
    }
    
    // Resize to cover the dimensions
    baseImage = baseImage.resize({
      width,
      height,
      fit: 'cover',
      position: 'center'
    });
    
    // Create dark overlay for bottom portion
    const overlayHeight = Math.round(height * 0.4); // 40% of image height
    const overlay = await sharp({
      create: {
        width,
        height: overlayHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0.7 } // Semi-transparent black
      }
    }).png().toBuffer();
    
    // Add the overlay to the bottom of the image
    baseImage = baseImage.composite([{
      input: overlay,
      gravity: 'south'
    }]);
    
    // Try to load logo if available
    const logoPath = path.join(process.cwd(), 'src', 'assets', 'logo.png');
    const compositeElements = [];
    
    if (fs.existsSync(logoPath)) {
      // Resize logo to appropriate size (15% of width)
      const logoWidth = Math.round(width * 0.15);
      const logoBuffer = await sharp(logoPath)
        .resize({ width: logoWidth })
        .toBuffer();
      
      compositeElements.push({
        input: logoBuffer,
        gravity: 'northwest',
        top: 20,
        left: 20
      });
    }
    
    // Create SVG for text overlays
    const titleFontSize = Math.round(width * 0.045);
    const dateFontSize = Math.round(width * 0.03);
    const overlineFontSize = Math.round(width * 0.035);
    
    const svgText = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <style>
          .title { fill: white; font-family: Arial, sans-serif; font-weight: bold; font-size: ${titleFontSize}px; text-anchor: middle; }
          .date { fill: #cccccc; font-family: Arial, sans-serif; font-size: ${dateFontSize}px; text-anchor: middle; }
          .overline { fill: white; font-family: Arial, sans-serif; font-size: ${overlineFontSize}px; text-anchor: middle; }
        </style>
        <text x="${width/2}" y="${height - 80}" class="title">${title}</text>
        <text x="${width/2}" y="${height - 30}" class="date">${date}</text>
        ${overline ? `<text x="${width/2}" y="${height - 130}" class="overline">${overline}</text>` : ''}
      </svg>
    `;
    
    // Add text SVG to composite elements
    compositeElements.push({
      input: Buffer.from(svgText),
      gravity: 'center'
    });
    
    // Apply all composite elements
    if (compositeElements.length > 0) {
      baseImage = baseImage.composite(compositeElements);
    }
    
    // Write output file
    await baseImage.toFile(outputPath);
    
    return outputPath;
  } catch (error) {
    logger.error('Error generating image with Sharp:', error);
    throw error;
  }
}

/**
 * Upload image to Airtable as attachment
 */
async function uploadToAirtable(imagePath, recordId, platform) {
  try {
    // Get Airtable credentials
    const apiKey = process.env.AIRTABLE_TOKEN;
    const baseId = process.env.AIRTABLE_BASE_ID;
    
    if (!apiKey || !baseId) {
      throw new Error('Missing Airtable credentials');
    }
    
    // Create filename
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `${platform}-${timestamp}.png`;
    
    // Read image file
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Content = imageBuffer.toString('base64');
    
    // Initialize Airtable
    const airtable = new Airtable({ apiKey });
    const base = airtable.base(baseId);
    
    // Create field name based on platform
    const fieldName = `social_image_${platform.toLowerCase()}`;
    
    // Create update object
    const updateFields = {};
    updateFields[fieldName] = [{
      filename,
      type: 'image/png',
      _base64Content: base64Content
    }];
    
    // Update Airtable record
    const record = await base('Redes Sociales').update(recordId, updateFields);
    
    return record.fields[fieldName] && record.fields[fieldName][0] ? 
      record.fields[fieldName][0].url : null;
  } catch (error) {
    logger.error('Error uploading to Airtable:', error);
    throw error;
  }
}

// Update the airtable-generate endpoint

/**
 * API endpoint for Airtable button
 * GET /api/social-media-images/airtable-generate
 */
router.get('/airtable-generate', async (req, res) => {
  try {
    // Get parameters
    const { 
      recordId, 
      title, 
      overline = '', 
      imgUrl = null,
      platform = 'facebook' 
    } = req.query;
    
    if (!recordId || !title) {
      return res.status(400).send(`
        <html>
          <head><title>Error</title></head>
          <body>
            <h1 style="color: red;">Missing Required Parameters</h1>
            <p>Record ID and title are required.</p>
          </body>
        </html>
      `);
    }
    
    // Format date
    const dateStr = new Date().toLocaleDateString('es-ES', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
    
    // Generate image from template
    const imagePath = await generateFromTemplate({
      title,
      overline,
      backgroundUrl: imgUrl,
      date: dateStr,
      platform
    });
    
    // Convert to base64 for preview
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    // Send HTML preview
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Social Media Image</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { 
              font-family: Arial, sans-serif; 
              margin: 0; 
              padding: 20px; 
              background: #f5f5f5; 
              text-align: center;
            }
            .container {
              max-width: 800px;
              margin: 0 auto;
              background: white;
              border-radius: 10px;
              padding: 20px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            h1 { color: #333; }
            .image { 
              max-width: 100%; 
              height: auto; 
              margin: 20px 0; 
              border: 1px solid #ddd;
            }
            .button {
              display: inline-block;
              padding: 10px 20px;
              border: none;
              border-radius: 5px;
              font-weight: bold;
              font-size: 16px;
              cursor: pointer;
              margin: 10px;
            }
            .save { background: #4CAF50; color: white; }
            .cancel { background: #f44336; color: white; }
            #message { 
              padding: 10px;
              margin-top: 20px;
              border-radius: 5px;
              display: none;
            }
            .success { background: #e8f5e9; color: green; }
            .error { background: #ffebee; color: red; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Social Media Image Preview</h1>
            <p>Platform: ${platform}</p>
            
            <img src="data:image/png;base64,${base64Image}" alt="Preview" class="image">
            
            <div>
              <button class="button save" id="save-button">Save to Airtable</button>
              <button class="button cancel" onclick="window.close()">Cancel</button>
            </div>
            
            <div id="message"></div>
          </div>
          
          <script>
            document.getElementById('save-button').addEventListener('click', async function() {
              try {
                const button = this;
                const message = document.getElementById('message');
                
                // Disable button
                button.disabled = true;
                button.textContent = 'Saving...';
                
                // Send request
                const response = await fetch('/api/social-media-images/save-to-airtable', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    recordId: '${recordId}',
                    imagePath: '${imagePath}',
                    platform: '${platform}'
                  })
                });
                
                const data = await response.json();
                
                if (data.success) {
                  message.className = 'success';
                  message.textContent = 'Image saved successfully!';
                  message.style.display = 'block';
                  
                  // Close window after 3 seconds
                  setTimeout(() => window.close(), 3000);
                } else {
                  throw new Error(data.error);
                }
              } catch (error) {
                const message = document.getElementById('message');
                message.className = 'error';
                message.textContent = 'Error: ' + (error.message || 'Failed to save');
                message.style.display = 'block';
                
                // Reset button
                const button = document.getElementById('save-button');
                button.disabled = false;
                button.textContent = 'Try Again';
              }
            });
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    logger.error('Error in airtable-generate endpoint:', error);
    res.status(500).send(`
      <html>
        <head><title>Error</title></head>
        <body>
          <h1 style="color: red;">Error</h1>
          <p>${error.message || 'An unknown error occurred'}</p>
        </body>
      </html>
    `);
  }
});

/**
 * API endpoint to save image to Airtable
 * POST /api/social-media-images/save-to-airtable
 */
router.post('/save-to-airtable', async (req, res) => {
  try {
    const { recordId, imagePath, platform } = req.body;
    
    if (!recordId || !imagePath || !platform) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters'
      });
    }
    
    // Upload to Airtable
    const imageUrl = await uploadToAirtable(imagePath, recordId, platform);
    
    // Delete temp file
    try {
      fs.unlinkSync(imagePath);
    } catch (e) {
      logger.warn('Failed to delete temp file:', e);
    }
    
    return res.json({
      success: true,
      data: { imageUrl }
    });
  } catch (error) {
    logger.error('Error in save-to-airtable endpoint:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to save to Airtable'
    });
  }
});

// Add a new endpoint to generate images for all platforms

/**
 * Generate images for all platforms and save directly to Airtable
 * POST /api/social-media-images/generate-all-platforms
 */
router.post('/generate-all-platforms', async (req, res) => {
  try {
    const { recordId, title, overline = '', imgUrl = null } = req.body;
    
    if (!recordId || !title) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: recordId and title are required'
      });
    }
    
    // Format date
    const dateStr = new Date().toLocaleDateString('es-ES', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
    
    // Platforms to generate
    const platforms = ['facebook', 'twitter', 'instagram'];
    const results = {};
    
    // Generate and upload images for each platform
    for (const platform of platforms) {
      try {
        // Generate image
        const imagePath = await generateFromTemplate({
          title,
          overline,
          backgroundUrl: imgUrl,
          date: dateStr,
          platform
        });
        
        // Upload to Airtable
        const imageUrl = await uploadToAirtable(imagePath, recordId, platform);
        results[platform] = { success: true, url: imageUrl };
        
        // Clean up temp file
        try {
          fs.unlinkSync(imagePath);
        } catch (e) {
          logger.warn(`Failed to delete temp file for ${platform}:`, e);
        }
      } catch (platformError) {
        logger.error(`Error generating ${platform} image:`, platformError);
        results[platform] = { success: false, error: platformError.message };
      }
    }
    
    // Return results
    return res.json({
      success: true,
      message: 'Image generation complete',
      results
    });
  } catch (error) {
    logger.error('Error in generate-all-platforms endpoint:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate images'
    });
  }
});

export default router;