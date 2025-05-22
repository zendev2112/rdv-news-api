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
    transformations.push({
      overlay: "black_rectangle",  // We'll create this asset
      width: width,
      height: Math.round(height * 0.5),
      gravity: "south",
      opacity: 70
    });

    // Add title text
    transformations.push({
      overlay: {
        font_family: "Arial",
        font_size: 60,  // Fixed size instead of calculated
        text: encodeURIComponent(title)
      },
      color: "white",
      gravity: "south", 
      y: 120
    });

    // Add overline if provided
    if (overline) {
      transformations.push({
        overlay: {
          font_family: "Arial",
          font_size: 40,  // Fixed size instead of calculated
          text: encodeURIComponent(overline)
        },
        color: "white",
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