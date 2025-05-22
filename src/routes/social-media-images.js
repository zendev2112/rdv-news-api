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
import cloudinaryService from '../services/cloudinary.js';
import { v2 as cloudinary } from 'cloudinary';

const router = express.Router();
const execAsync = promisify(exec);

// Ensure temp directory exists
const TEMP_DIR = path.join(os.tmpdir(), 'rdv-images');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Generate image using Cloudinary to solve text rendering issues
 */
async function generateFromTemplate(options) {
  const { 
    title, 
    overline = '', 
    backgroundUrl = null,
    date, 
    platform = 'facebook',
    // New styling options with defaults
    fontFamily = 'Arial',
    fontWeight = 'bold',
    textColor = 'white',
    overlayOpacity = 70,
    overlayColor = '000000',
    gradientFade = false // Enable gradient fade effect
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
    
    // Create output path for final image
    const outputPath = path.join(TEMP_DIR, `${platform}-${Date.now()}.png`);
    
    // Step 1: Upload or use background image in Cloudinary
    let backgroundPublicId;
    
    if (backgroundUrl) {
      try {
        // Upload external image URL to Cloudinary
        const uploadResult = await cloudinary.uploader.upload(backgroundUrl, {
          folder: 'rdv-news/backgrounds',
          public_id: `bg-${Date.now()}`,
          resource_type: 'auto'
        });
        backgroundPublicId = uploadResult.public_id;
      } catch (err) {
        logger.warn(`Failed to upload background image: ${err.message}`);
        // Use a solid blue color instead
        backgroundPublicId = 'rdv-news/defaults/blue-background';
        // If this is the first time, create the default background
        try {
          await cloudinary.uploader.upload('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFdgI2RLQzngAAAABJRU5ErkJggg==', {
            folder: 'rdv-news/defaults',
            public_id: 'blue-background',
            colors: true,
            background: '#172a88'
          });
        } catch (uploadErr) {
          // Ignore if already exists
        }
      }
    } else {
      // Use default blue background
      backgroundPublicId = 'rdv-news/defaults/blue-background';
      // If this is the first time, create the default background
      try {
        await cloudinary.uploader.upload('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFdgI2RLQzngAAAABJRU5ErkJggg==', {
          folder: 'rdv-news/defaults',
          public_id: 'blue-background',
          colors: true,
          background: '#172a88'
        });
      } catch (uploadErr) {
        // Ignore if already exists
      }
    }
    
    // Step 2: Build transformation array for Cloudinary
    let transformations = [];

    // First resize the image
    transformations.push({
      width,
      height,
      crop: 'fill'
    });

    // We need to split up the transformations into a chain that Cloudinary can process
    // Instead of using effect:colorize which affects the whole image,
    // we'll use an underlay with a semi-transparent black rectangle
    if (gradientFade) {
      // Create gradient overlay - this gives a smooth fade effect
      transformations.push({
        overlay: {
          url: `data:image/png;base64,${await createGradientBase64(overlayColor, width, Math.round(height * 0.6))}` 
        },
        gravity: "south",
        width: width,
        height: Math.round(height * 0.6) // Make it slightly taller for fade
      });
    } else {
      // Use existing solid color overlay if gradient not enabled
      transformations.push({
        overlay: "black_rectangle",  
        width: width,
        height: Math.round(height * 0.5),
        gravity: "south",
        opacity: overlayOpacity
      });
    }

    // Add title text
    transformations.push({
      overlay: {
        font_family: fontFamily,
        font_size: 60,
        font_weight: fontWeight,
        text: encodeURIComponent(title)
      },
      color: textColor,
      gravity: "south", 
      y: 120
    });

    // Add overline if provided
    if (overline) {
      transformations.push({
        overlay: {
          font_family: fontFamily,
          font_size: 40,
          font_weight: fontWeight,
          text: encodeURIComponent(overline)
        },
        color: textColor,
        gravity: "south",
        y: 180
      });
    }

    // First, make sure we have a black rectangle asset
    try {
      await cloudinary.api.resource('rdv-news/defaults/black_rectangle');
      logger.debug('Black rectangle asset exists');
    } catch (err) {
      try {
        // Create black rectangle if it doesn't exist
        await cloudinary.uploader.upload(
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==',
          {
            folder: 'rdv-news/defaults',
            public_id: 'black_rectangle',
            colors: true,
            background: '#000000'
          }
        );
        logger.debug('Created black rectangle asset');
      } catch (uploadErr) {
        logger.error('Failed to create black rectangle:', uploadErr);
      }
    }

    // Generate simplified Cloudinary URL that should work
    const imageUrl = cloudinary.url(backgroundPublicId, {
      transformation: transformations,
      sign_url: true,
      secure: true
    });

    logger.info(`Generated Cloudinary URL: ${imageUrl}`);

    // If we still have issues, fallback to a very basic transformation
    let response = await fetch(imageUrl);

    // If the complex URL fails, fall back to a simpler one
    if (!response.ok) {
      logger.warn(`Complex URL failed with status ${response.status}, trying fallback`);
      
      // Just resize the image with minimal transformations
      const fallbackUrl = cloudinary.url(backgroundPublicId, {
        transformation: [
          { width, height, crop: 'fill' },
          {
            overlay: {
              font_family: "Arial",
              font_size: 60,
              text: encodeURIComponent(title)
            },
            color: "white",
            gravity: "center"
          }
        ],
        sign_url: true, 
        secure: true
      });
      
      logger.info(`Fallback Cloudinary URL: ${fallbackUrl}`);
      response = await fetch(fallbackUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status}`);
      }
    }

    // Continue with your existing code to process the response
    const imageBuffer = await response.buffer();
    fs.writeFileSync(outputPath, imageBuffer);
    
    return outputPath;
  } catch (error) {
    logger.error('Error generating image with Cloudinary:', error);
    throw error;
  }
}

/**
 * Create a gradient overlay as base64
 * @param {string} color - Hex color code without #
 * @param {number} width - Width in pixels
 * @param {number} height - Height in pixels
 * @returns {Promise<string>} - Base64 encoded PNG with gradient
 */
async function createGradientBase64(color, width, height) {
  // Create a transparent-to-color gradient
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#${color}00" />
          <stop offset="40%" stop-color="#${color}99" />
          <stop offset="100%" stop-color="#${color}CC" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#gradient)" />
    </svg>
  `;
  
  try {
    const buffer = await sharp(Buffer.from(svg))
      .png()
      .toBuffer();
    return buffer.toString('base64');
  } catch (error) {
    logger.error('Error creating gradient:', error);
    // Fallback to solid color
    return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==';
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
    
    // Prepare the HTML template
    const htmlContent = `
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
              transition: all 0.2s ease;
            }
            .button:hover {
              transform: translateY(-2px);
              box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            }
            .save { background: #4CAF50; color: white; }
            .edit { background: #2196F3; color: white; }
            .cancel { background: #f44336; color: white; }
            #message { 
              padding: 10px;
              margin-top: 20px;
              border-radius: 5px;
              display: none;
            }
            .success { background: #e8f5e9; color: green; }
            .error { background: #ffebee; color: red; }
            
            /* Styling controls */
            .edit-controls {
              background: #f9f9f9;
              border: 1px solid #ddd;
              padding: 15px;
              border-radius: 8px;
              margin-bottom: 20px;
              display: none;
              text-align: left;
            }
            .edit-controls.active {
              display: block;
            }
            .control-row {
              display: flex;
              flex-wrap: wrap;
              gap: 15px;
              margin-bottom: 15px;
            }
            .control-group {
              flex: 1;
              min-width: 200px;
            }
            label {
              display: block;
              margin-bottom: 5px;
              font-weight: bold;
              color: #555;
            }
            select, input, .slider {
              width: 100%;
              padding: 8px;
              border: 1px solid #ccc;
              border-radius: 4px;
            }
            .color-options {
              display: flex;
              gap: 8px;
            }
            .color-option {
              width: 30px;
              height: 30px;
              border-radius: 50%;
              cursor: pointer;
              border: 2px solid transparent;
            }
            .color-option.selected {
              border-color: #000;
            }
            .toggle-switch {
              position: relative;
              display: inline-block;
              width: 60px;
              height: 34px;
            }
            .toggle-switch input {
              opacity: 0;
              width: 0;
              height: 0;
            }
            .slider-toggle {
              position: absolute;
              cursor: pointer;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              background-color: #ccc;
              transition: .4s;
              border-radius: 34px;
            }
            .slider-toggle:before {
              position: absolute;
              content: "";
              height: 26px;
              width: 26px;
              left: 4px;
              bottom: 4px;
              background-color: white;
              transition: .4s;
              border-radius: 50%;
            }
            input:checked + .slider-toggle {
              background-color: #2196F3;
            }
            input:checked + .slider-toggle:before {
              transform: translateX(26px);
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Social Media Image Preview</h1>
            <p>Platform: ${platform}</p>
            
            <button class="button edit" id="toggle-edit">Edit Styling</button>
            
            <div class="edit-controls" id="edit-controls">
              <div class="control-row">
                <div class="control-group">
                  <label for="font-family">Font Family</label>
                  <select id="font-family">
                    <option value="Arial" selected>Arial</option>
                    <option value="Roboto">Roboto</option>
                    <option value="Helvetica">Helvetica</option>
                    <option value="Montserrat">Montserrat</option>
                    <option value="Open Sans">Open Sans</option>
                  </select>
                </div>
                
                <div class="control-group">
                  <label for="font-weight">Font Weight</label>
                  <select id="font-weight">
                    <option value="normal">Normal</option>
                    <option value="bold" selected>Bold</option>
                  </select>
                </div>
              </div>
              
              <div class="control-row">
                <div class="control-group">
                  <label>Text Color</label>
                  <div class="color-options">
                    <div class="color-option selected" style="background-color: white;" data-color="white"></div>
                    <div class="color-option" style="background-color: #ffeb3b;" data-color="#ffeb3b"></div>
                    <div class="color-option" style="background-color: #ff5722;" data-color="#ff5722"></div>
                    <div class="color-option" style="background-color: #4caf50;" data-color="#4caf50"></div>
                    <div class="color-option" style="background-color: #2196f3;" data-color="#2196f3"></div>
                  </div>
                </div>
                
                <div class="control-group">
                  <label>Overlay Color</label>
                  <div class="color-options">
                    <div class="color-option selected" style="background-color: black;" data-color="000000"></div>
                    <div class="color-option" style="background-color: #1a237e;" data-color="1a237e"></div>
                    <div class="color-option" style="background-color: #b71c1c;" data-color="b71c1c"></div>
                    <div class="color-option" style="background-color: #1b5e20;" data-color="1b5e20"></div>
                    <div class="color-option" style="background-color: #4a148c;" data-color="4a148c"></div>
                  </div>
                </div>
              </div>
              
              <div class="control-row">
                <div class="control-group">
                  <label for="overlay-opacity">Overlay Opacity</label>
                  <input type="range" id="overlay-opacity" min="0" max="100" value="70" class="slider">
                  <span id="opacity-value">70%</span>
                </div>
                
                <div class="control-group">
                  <label for="gradient-fade">Gradient Fade Effect</label>
                  <label class="toggle-switch">
                    <input type="checkbox" id="gradient-fade">
                    <span class="slider-toggle"></span>
                  </label>
                </div>
              </div>
              
              <button class="button edit" id="apply-changes">Apply Changes</button>
            </div>
            
            <img src="data:image/png;base64,${base64Image}" alt="Preview" class="image" id="preview-image">
            
            <div>
              <button class="button save" id="save-button">Save to Airtable</button>
              <button class="button cancel" onclick="window.close()">Cancel</button>
            </div>
            
            <div id="message"></div>
          </div>
          
          <script>
            // Replace template variables with actual JavaScript values
            const RECORD_ID = "${recordId}";
            const TITLE = "${title.replace(/"/g, '\\"')}";
            const OVERLINE = "${overline.replace(/"/g, '\\"')}";
            const IMG_URL = "${imgUrl ? imgUrl.replace(/"/g, '\\"') : ''}";
            const PLATFORM = "${platform}";
            const IMAGE_PATH = "${imagePath}";
            
            // Toggle edit controls
            document.getElementById('toggle-edit').addEventListener('click', function() {
              const controls = document.getElementById('edit-controls');
              controls.classList.toggle('active');
              this.textContent = controls.classList.contains('active') ? 'Hide Styling' : 'Edit Styling';
            });
            
            // Update opacity value display
            document.getElementById('overlay-opacity').addEventListener('input', function() {
              document.getElementById('opacity-value').textContent = this.value + '%';
            });
            
            // Handle color selection
            document.querySelectorAll('.color-option').forEach(option => {
              option.addEventListener('click', function() {
                // Find all siblings and remove selected class
                const siblings = this.parentElement.querySelectorAll('.color-option');
                siblings.forEach(sib => sib.classList.remove('selected'));
                
                // Add selected class to clicked option
                this.classList.add('selected');
              });
            });
            
            // Apply changes button
            document.getElementById('apply-changes').addEventListener('click', async function() {
              try {
                const message = document.getElementById('message');
                this.textContent = 'Generating...';
                this.disabled = true;
                
                // Gather styling options
                const fontFamily = document.getElementById('font-family').value;
                const fontWeight = document.getElementById('font-weight').value;
                const textColor = document.querySelector('.color-options:nth-of-type(1) .color-option.selected').getAttribute('data-color');
                const overlayColor = document.querySelector('.color-options:nth-of-type(2) .color-option.selected').getAttribute('data-color');
                const overlayOpacity = document.getElementById('overlay-opacity').value;
                const gradientFade = document.getElementById('gradient-fade').checked;
                
                // Make API request to regenerate with styling
                const response = await fetch('/api/social-media-images/regenerate-styled', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    recordId: RECORD_ID,
                    title: TITLE,
                    overline: OVERLINE,
                    imgUrl: IMG_URL,
                    platform: PLATFORM,
                    styling: {
                      fontFamily,
                      fontWeight,
                      textColor,
                      overlayColor,
                      overlayOpacity: parseInt(overlayOpacity),
                      gradientFade
                    }
                  })
                });
                
                if (!response.ok) {
                  throw new Error(``);
                }
                
                const blob = await response.blob();
                const imageUrl = URL.createObjectURL(blob);
                document.getElementById('preview-image').src = imageUrl;
                
                this.textContent = 'Apply Changes';
                this.disabled = false;
                
                message.className = 'success';
                message.textContent = 'Image updated successfully';
                message.style.display = 'block';
                
                setTimeout(() => {
                  message.style.display = 'none';
                }, 3000);
                
              } catch (error) {
                console.error('Error applying changes:', error);
                
                const message = document.getElementById('message');
                message.className = 'error';
                message.textContent = error.message || 'Failed to update image';
                message.style.display = 'block';
                
                this.textContent = 'Apply Changes';
                this.disabled = false;
              }
            });
            
            // Save button handler (existing code)
            document.getElementById('save-button').addEventListener('click', async function() {
              try {
                const button = this;
                const message = document.getElementById('message');
                
                // Disable button
                button.disabled = true;
                button.textContent = 'Saving...';
                
                // Get current styling options in case they've been changed
                const styling = {};
                
                if (document.getElementById('edit-controls').classList.contains('active')) {
                  styling.fontFamily = document.getElementById('font-family').value;
                  styling.fontWeight = document.getElementById('font-weight').value;
                  styling.textColor = document.querySelector('.color-options:nth-of-type(1) .color-option.selected').getAttribute('data-color');
                  styling.overlayColor = document.querySelector('.color-options:nth-of-type(2) .color-option.selected').getAttribute('data-color');
                  styling.overlayOpacity = parseInt(document.getElementById('overlay-opacity').value);
                  styling.gradientFade = document.getElementById('gradient-fade').checked;
                }
                
                // Send request
                const response = await fetch('/api/social-media-images/save-to-airtable', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    recordId: RECORD_ID,
                    imagePath: IMAGE_PATH,
                    platform: PLATFORM,
                    styling: Object.keys(styling).length > 0 ? styling : undefined
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
    `;

    // Send the processed HTML
    res.send(htmlContent);
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
    const { recordId, imagePath, platform, styling } = req.body;
    
    if (!recordId || !imagePath || !platform) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters'
      });
    }
    
    let imagePathToUpload = imagePath;
    
    // If styling options provided, regenerate the image before saving
    if (styling) {
      // Format date
      const dateStr = new Date().toLocaleDateString('es-ES', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });
      
      // Get record details from Airtable
      const apiKey = process.env.AIRTABLE_TOKEN;
      const baseId = process.env.AIRTABLE_BASE_ID;
      const airtable = new Airtable({ apiKey });
      const base = airtable.base(baseId);
      
      // Fetch the record to get title and image URL
      const record = await base('Redes Sociales').find(recordId);
      const title = record.fields.titulo || '';
      const imgUrl = record.fields.imagen_url || null;
      const overline = record.fields.copete || '';
      
      // Generate a new image with styling
      imagePathToUpload = await generateFromTemplate({
        title,
        overline,
        backgroundUrl: imgUrl,
        date: dateStr,
        platform,
        ...styling
      });
      
      // Delete the original temp file
      try {
        fs.unlinkSync(imagePath);
      } catch (e) {
        logger.warn('Failed to delete original temp file:', e);
      }
    }
    
    // Upload to Airtable
    const imageUrl = await uploadToAirtable(imagePathToUpload, recordId, platform);
    
    // Delete temp file
    try {
      fs.unlinkSync(imagePathToUpload);
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

// Add this new endpoint

/**
 * API endpoint to regenerate image with custom styling
 * POST /api/social-media-images/regenerate-styled
 */
router.post('/regenerate-styled', async (req, res) => {
  try {
    const { 
      recordId, 
      title, 
      overline = '', 
      imgUrl = null,
      platform = 'facebook',
      styling = {}
    } = req.body;
    
    if (!recordId || !title) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: recordId and title'
      });
    }
    
    // Format date
    const dateStr = new Date().toLocaleDateString('es-ES', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
    
    // Extract styling options
    const {
      fontFamily = 'Arial',
      fontWeight = 'bold',
      textColor = 'white',
      overlayColor = '000000',
      overlayOpacity = 70,
      gradientFade = false
    } = styling;
    
    // Generate image with styling options
    const imagePath = await generateFromTemplate({
      title,
      overline,
      backgroundUrl: imgUrl,
      date: dateStr,
      platform,
      fontFamily,
      fontWeight, 
      textColor,
      overlayColor,
      overlayOpacity,
      gradientFade
    });
    
    // Return the generated image
    res.sendFile(imagePath, {}, (err) => {
      if (err) {
        logger.error('Error sending file:', err);
        if (!res.headersSent) {
          return res.status(500).json({ 
            success: false, 
            error: 'Failed to send image' 
          });
        }
      }
      
      // Clean up temp file
      try {
        fs.unlinkSync(imagePath);
      } catch (e) {
        logger.warn('Failed to delete temp file:', e);
      }
    });
  } catch (error) {
    logger.error('Error regenerating styled image:', error);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: error.message || 'Failed to regenerate image'
      });
    }
  }
});

export default router;