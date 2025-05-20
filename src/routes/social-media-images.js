import express from 'express';
import Airtable from 'airtable';
import logger from '../utils/logger.js';
import config from '../config/index.js';
import imageGenerator from '../services/image-generator.js';
import { uploadImage } from '../services/cloudinary.js';
import { createCanvas, loadImage, registerFont } from 'canvas';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import textRenderer from '../services/text-renderer.js';
import sharp from 'sharp';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Create images directory if needed
const imagesDir = path.join(__dirname, '../../assets/images');
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

// Create fonts directory if it doesn't exist
const fontDir = path.join(__dirname, '../../assets/fonts');
if (!fs.existsSync(fontDir)) {
  fs.mkdirSync(fontDir, { recursive: true });
}

// Embed a small open-source font directly in your code as Base64
// This is the Roboto font in compressed Base64 format
const robotoFontBase64 = "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";

// Write the Base64 font to a file
const robotoFontPath = path.join(fontDir, 'roboto-embedded.ttf');
if (!fs.existsSync(robotoFontPath)) {
  try {
    fs.writeFileSync(robotoFontPath, Buffer.from(robotoFontBase64, 'base64'));
    logger.info('Embedded Roboto font written to file');
  } catch (err) {
    logger.error('Failed to write embedded font:', err);
  }
}

// Register the embedded font
try {
  registerFont(robotoFontPath, { family: 'Roboto' });
  logger.info('Embedded Roboto font registered successfully');
} catch (err) {
  logger.error('Failed to register embedded font:', err);
}

// Log the font status
logger.info(`Using font: ${textRenderer.getBestAvailableFont()}`);

/**
 * Draw text on image with proper fallbacks
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {string} text - Text to draw
 * @param {number} x - X position (center)
 * @param {number} y - Y position (center)
 * @param {Object} options - Font options
 */
function drawTextWithFallback(ctx, text, x, y, options = {}) {
  const { 
    fontSize = 24, 
    color = '#FFFFFF',
    fontWeight = 'normal',
    maxWidth = undefined
  } = options;
  
  // IMPORTANT: Save context state
  ctx.save();
  
  try {
    // Add a background behind text for better contrast
    const textWidth = maxWidth || (text.length * fontSize * 0.6);
    const textHeight = fontSize * 1.4;
    
    // Draw semi-transparent background behind text
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(
      x - textWidth / 2 - 10, 
      y - textHeight / 2 - 5, 
      textWidth + 20, 
      textHeight + 10
    );
    
    // Set text shadow for better visibility
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    
    // Try multiple fonts in order - ONE should work
    // The key is to be explicit and try multiple options
    const fontFamily = fontWeight === 'bold' ? 
      'bold Arial, bold Helvetica, bold Roboto, bold sans-serif' : 
      'Arial, Helvetica, Roboto, sans-serif';
    
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Log the exact font being used
    logger.info(`Drawing text: "${text}" with font: ${ctx.font}`);
    
    if (maxWidth) {
      // Draw text multiple times for better visibility
      ctx.fillText(text, x, y, maxWidth);
      ctx.fillText(text, x, y, maxWidth); // Second pass
    } else {
      ctx.fillText(text, x, y);
      ctx.fillText(text, x, y); // Second pass
    }
    
    // Add a subtle white outline to make text pop
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    if (maxWidth) {
      ctx.strokeText(text, x, y, maxWidth);
    } else {
      ctx.strokeText(text, x, y);
    }
  } catch (error) {
    logger.error(`Text rendering failed: ${error.message}, falling back to rectangle`);
    
    // Last resort - create a white rectangle with proportional size
    const rectWidth = maxWidth || Math.min(text.length * fontSize * 0.6, ctx.canvas.width * 0.8);
    const rectHeight = fontSize * 0.4;
    
    ctx.fillStyle = color;
    ctx.fillRect(x - rectWidth/2, y - rectHeight/2, rectWidth, rectHeight);
  }
  
  // IMPORTANT: Restore context state to prevent issues
  ctx.restore();
}

/**
 * Draw wrapped text with proper fallbacks
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {string} text - Text to draw
 * @param {number} x - X position (center)
 * @param {number} y - Y position (top)
 * @param {number} maxWidth - Maximum width
 * @param {Object} options - Font options
 */
function drawWrappedTextWithFallback(ctx, text, x, y, maxWidth, options = {}) {
  const { 
    fontSize = 24, 
    lineHeight = fontSize * 1.2,
    color = '#FFFFFF',
    fontWeight = 'normal'
  } = options;
  
  textRenderer.drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, {
    fontSize,
    color,
    fontWeight,
    textAlign: 'center'
  });
}

/**
 * Add logo to the canvas
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @returns {Promise<boolean>} Whether logo was added successfully
 */
async function addLogo(ctx, width, height) {
  try {
    // Path to the logo file
    const logoPath = path.join(__dirname, '../../assets/images/rdv-negro.png');
    
    if (fs.existsSync(logoPath)) {
      // Load the logo
      const logo = await loadImage(logoPath);
      
      // Set logo size (10% of the image height)
      const logoHeight = Math.floor(height * 0.1);
      const logoWidth = (logo.width / logo.height) * logoHeight;
      
      // Position in top left with some padding
      const padding = 20;
      
      // Draw the logo
      ctx.drawImage(logo, padding, padding, logoWidth, logoHeight);
      
      logger.info('Logo added to image');
      return true;
    } else {
      // Try to create a text logo instead
      logger.warn(`Logo not found at ${logoPath}, using text logo fallback`);
      
      ctx.save();
      
      // Create a semi-transparent background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(10, 10, Math.floor(width * 0.25), Math.floor(height * 0.08));
      
      // Add text in place of logo
      drawTextWithFallback(
        ctx, 
        "RADIO DEL VOLGA",
        Math.floor(width * 0.13), 
        Math.floor(height * 0.05),
        { 
          fontSize: Math.floor(height * 0.04),
          color: '#FFFFFF',
          fontWeight: 'bold'
        }
      );
      
      ctx.restore();
      return true;
    }
  } catch (error) {
    logger.error('Error adding logo:', error);
    return false;
  }
}

/**
 * Create an image with text using SVG for reliable text rendering
 * @param {Buffer} imageBuffer - Base image buffer
 * @param {string} title - Title text
 * @param {string} date - Date text
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Promise<Buffer>} - Final image buffer
 */
async function createImageWithSVGText(imageBuffer, title, date, width, height) {
  try {
    // Encode special characters for proper XML
    const safeTitle = title.replace(/&/g, '&amp;').replace(/<//g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const safeDate = date.replace(/&/g, '&amp;').replace(/<//g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    
    // Create an SVG that embeds the base image and adds text on top with system fonts only
    const svgText = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <!-- Embed the base image -->
        <image href="data:image/png;base64,${imageBuffer.toString('base64')}" width="${width}" height="${height}" />
        
        <!-- Add solid background for text -->
        <rect x="0" y="${height - 120}" width="${width}" height="120" fill="rgba(0, 0, 0, 0.85)" />
        
        <!-- Draw title text using only system fonts -->
        <text 
          x="${width / 2}" 
          y="${height - 60}" 
          font-family="Arial, Helvetica, sans-serif" 
          font-size="${Math.floor(width * 0.055)}px" 
          font-weight="bold" 
          fill="white" 
          text-anchor="middle"
          dominant-baseline="middle">
          ${safeTitle}
        </text>
        
        <!-- Draw date text using only system fonts -->
        <text 
          x="${width / 2}" 
          y="${height - 25}" 
          font-family="Arial, Helvetica, sans-serif" 
          font-size="${Math.floor(width * 0.035)}px" 
          fill="#cccccc" 
          text-anchor="middle"
          dominant-baseline="middle">
          ${safeDate}
        </text>
      </svg>
    `;

    // Convert SVG to PNG with Sharp
    const outputBuffer = await sharp(Buffer.from(svgText))
      .png({ compressionLevel: 0 }) // No compression for better quality
      .toBuffer();
    
    return outputBuffer;
  } catch (error) {
    logger.error('Error creating image with SVG text:', error);
    // Return the original image if there was an error
    return imageBuffer;
  }
}

// Also add an Instagram-specific version
async function createInstagramImageWithSVGText(imageBuffer, title, date, width, height) {
  try {
    // Encode special characters for proper XML
    const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const safeDate = date.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    
    // Create an SVG that embeds the base image and adds text on top
    const svgText = `
      <?xml version="1.0" encoding="UTF-8" standalone="no"?>
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <!-- Embed the base image -->
        <image href="data:image/png;base64,${imageBuffer.toString('base64')}" width="${width}" height="${height}" />
        
        <!-- Add black background for text -->
        <rect x="0" y="${height - 120}" width="${width}" height="120" fill="rgba(0, 0, 0, 0.85)" />
        
        <!-- Define text styles once -->
        <style type="text/css">
          @font-face {
            font-family: 'CustomFont';
            src: url('https://fonts.gstatic.com/s/opensans/v29/memSYaGs126MiZpBA-UvWbX2vVnXBbObj2OVZyOOSr4dVJWUgsjZ0B4gaVI.woff2') format('woff2');
          }
          .title-text {
            font-family: 'CustomFont', Arial, sans-serif;
            font-size: ${Math.floor(width * 0.055)}px;
            font-weight: bold;
            fill: white;
            text-anchor: middle;
          }
          .date-text {
            font-family: 'CustomFont', Arial, sans-serif;
            font-size: ${Math.floor(width * 0.035)}px;
            fill: #cccccc;
            text-anchor: middle;
          }
        </style>
        
        <!-- Draw text outline for visibility -->
        <text 
          x="${width / 2}" 
          y="${height - 60}" 
          stroke="#000000"
          stroke-width="4"
          stroke-linejoin="round"
          class="title-text"
          opacity="0.8">
          ${safeTitle}
        </text>
        
        <!-- Draw title text -->
        <text 
          x="${width / 2}" 
          y="${height - 60}" 
          class="title-text">
          ${safeTitle}
        </text>
        
        <!-- Draw date text -->
        <text 
          x="${width / 2}" 
          y="${height - 25}" 
          class="date-text">
          ${safeDate}
        </text>
      </svg>
    `;

    // Use sharp to convert SVG to PNG with maximum quality
    const outputBuffer = await sharp(Buffer.from(svgText))
      .png({ compressionLevel: 0 })
      .toBuffer();
    
    return outputBuffer;
  } catch (error) {
    logger.error('Error creating Instagram image with SVG text:', error);
    return imageBuffer;
  }
}

const router = express.Router();

// Test GET endpoint
router.get('/generate', (req, res) => {
  res.json({
    success: true,
    message: 'The social media image generator endpoint is working',
    usage: 'Send a POST request to this endpoint with recordId, imageUrl, and title in the request body'
  });
});

// Root endpoint
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Social media images API is working',
    endpoints: {
      generate: '/api/social-media-images/generate',
      generateAll: '/api/social-media-images/generate-all'
    }
  });
});

/**
 * Generate social media image for a specific record
 * POST /api/social-media-images/generate
 */
router.post('/generate', async (req, res) => {
  try {
    const { recordId, platform = 'generic', imageUrl, title } = req.body;
    
    logger.info(`Received request to generate ${platform} image for record ${recordId}`);
    
    if (!recordId || !imageUrl || !title) {
      return res.status(400).json({
        success: false,
        error: 'Record ID, image URL, and title are required'
      });
    }
    
    // Test the image URL by trying to fetch headers
    try {
      const imageResponse = await fetch(imageUrl, { method: 'HEAD' });
      if (!imageResponse.ok) {
        return res.status(400).json({
          success: false, 
          error: `Image URL returned status ${imageResponse.status}`
        });
      }
    } catch (imageError) {
      return res.status(400).json({
        success: false,
        error: `Could not access image URL: ${imageError.message}`
      });
    }
    
    // Get Airtable credentials
    const apiToken = config.airtable?.personalAccessToken || process.env.AIRTABLE_TOKEN;
    const baseId = config.airtable?.baseId || process.env.AIRTABLE_BASE_ID;
    
    if (!apiToken || !baseId) {
      logger.error('Missing Airtable credentials');
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: Missing Airtable credentials'
      });
    }
    
    // Generate the image preview (this doesn't get saved, but can be used in frontend)
    logger.info('Generating image preview with title overlay');
    
    // Use better dimensions for preview image
    let width, height;
    switch (platform.toLowerCase()) {
      case 'instagram':
        width = 800;
        height = 800; // Square format
        break;
      case 'twitter':
        width = 1200;
        height = 675; // 16:9 ratio
        break;
      case 'facebook':
        width = 1200;
        height = 628; // Recommended for sharing
        break;
      default:
        width = 1200;
        height = 628; // Default format
    }
    
    // CRITICAL: Define safeTitle and dateStr HERE, before any code that uses them
    // Use ASCII characters only for maximum compatibility
    const safeTitle = title.replace(/[^\x00-\x7F]/g, ' ');
    const dateStr = new Date().toLocaleDateString('es-ES', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    }).replace(/[^\x00-\x7F]/g, ' ');
    
    // Create canvas
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Draw black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    

    try {
      // Load the source image
      const image = await loadImage(imageUrl);
      
      // Calculate aspect ratios
      const imageAspect = image.width / image.height;
      const canvasAspect = width / height;
      
      let sx, sy, sWidth, sHeight;
      
      if (imageAspect > canvasAspect) {
        // Image is wider than canvas (crop sides)
        sHeight = image.height;
        sWidth = image.height * canvasAspect;
        sy = 0;
        sx = (image.width - sWidth) / 2;
      } else {
        // Image is taller than canvas (crop top/bottom)
        sWidth = image.width;
        sHeight = image.width / canvasAspect;
        sx = 0;
        sy = (image.height - sHeight) / 3; // Crop more from bottom than top
      }
      
      // Draw the image
      ctx.drawImage(image, sx, sy, sWidth, sHeight, 0, 0, width, height);
      
      // Add the logo
      await addLogo(ctx, width, height);
      
      // Add a solid color background for text at the bottom
      // ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      // ctx.fillRect(0, height - 120, width, 120);
      
      // Draw title text with fallback
      drawTextWithFallback(
        ctx,
        safeTitle,
        width / 2,
        height - 60,
        {
          fontSize: Math.floor(width * 0.04),
          color: '#FFFFFF',
          fontWeight: 'bold',
          maxWidth: width * 0.9
        }
      );
      
      // Re-use the dateStr variable that was already declared
      
      // Draw date text with fallback
      drawTextWithFallback(
        ctx,
        dateStr,
        width / 2,
        height - 25,
        {
          fontSize: Math.floor(width * 0.025),
          color: '#cccccc'
        }
      );
    } catch (drawError) {
      logger.error('Error drawing image:', drawError);
      
      // Just draw placeholder on black background
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(width / 2 - 200, height / 2 - 20, 400, 40);
    }
    
    // Get the high-quality preview image for the response
    const previewDataUrl = canvas.toDataURL('image/jpeg', 1.0);
    
    // Initialize Airtable
    const airtable = new Airtable({ apiKey: apiToken });
    const base = airtable.base(baseId);
    
    // Create a timestamp for filenames
    const timestamp = new Date().toISOString().substring(0, 10);

    try {
      // First create a base image without text
      const baseBuffer = canvas.toBuffer('image/png');
      
      // Use SVG to add text reliably
      const uploadBuffer = await createImageWithSVGText(
        baseBuffer,
        safeTitle, // This is correct, keep using safeTitle
        dateStr,
        width,
        height
      );
      
      // Upload to Cloudinary with specific settings
      const fileName = `${platform.toLowerCase()}-${recordId}-${timestamp}.png`;
      const publicUrl = await uploadImage(uploadBuffer, fileName, {
        format: 'png',
        quality: 100
      });
      
      // Create update object with the Cloudinary URL
      const updateFields = {};
      
      if (platform.toLowerCase() === 'instagram') {
        updateFields.social_image_instagram = [{
          filename: fileName,
          url: publicUrl
        }];
      } else if (platform.toLowerCase() === 'twitter') {
        updateFields.social_image_twitter = [{
          filename: fileName,
          url: publicUrl
        }];
      } else if (platform.toLowerCase() === 'facebook') {
        updateFields.social_image_facebook = [{
          filename: fileName,
          url: publicUrl
        }];
      } else {
        // Generic/default platform - update all fields
        const igFileName = `instagram-${recordId}-${timestamp}.jpg`;
        const twFileName = `twitter-${recordId}-${timestamp}.jpg`;
        const fbFileName = `facebook-${recordId}-${timestamp}.jpg`;
        
        const igUrl = await uploadImage(uploadBuffer, igFileName);
        const twUrl = await uploadImage(uploadBuffer, twFileName);
        const fbUrl = await uploadImage(uploadBuffer, fbFileName);
        
        updateFields.social_image_instagram = [{
          filename: igFileName,
          url: igUrl
        }];
        updateFields.social_image_twitter = [{
          filename: twFileName,
          url: twUrl
        }];
        updateFields.social_image_facebook = [{
          filename: fbFileName,
          url: fbUrl
        }];
      }
      
      // Update Airtable record
      await base('Redes Sociales').update(recordId, updateFields);
      
      return res.json({
        success: true,
        message: `Generated and uploaded image for ${platform}`,
        data: {
          recordId,
          platform,
          title: title,
          previewWithTitle: previewDataUrl,
          imageUrl: publicUrl,
          titleText: safeTitle,
          dateText: dateStr,
          plainText: true,
          textPosition: {
            title: {
              x: width / 2,
              y: height - 60,
              fontSize: Math.floor(width * 0.04),
              maxWidth: width * 0.9
            },
            date: {
              x: width / 2,
              y: height - 25,
              fontSize: Math.floor(width * 0.025)
            }
          }
        }
      });
    } catch (uploadError) {
      logger.error('Error uploading image:', uploadError);
      
      return res.status(500).json({
        success: false,
        error: `Error uploading image: ${uploadError.message}`
      });
    }
  } catch (error) {
    logger.error('Error generating social media image:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate social media image'
    });
  }
});

/**
 * Generate social media images for multiple platforms
 * POST /api/social-media-images/generate-all
 */
router.post('/generate-all', async (req, res) => {
  try {
    const { recordId, imageUrl, title } = req.body;
    const platforms = ['facebook', 'twitter', 'instagram'];
    
    if (!recordId || !imageUrl || !title) {
      return res.status(400).json({
        success: false,
        error: 'Record ID, image URL, and title are required'
      });
    }
    
    // Test the image URL by trying to fetch headers
    try {
      const imageResponse = await fetch(imageUrl, { method: 'HEAD' });
      if (!imageResponse.ok) {
        return res.status(400).json({
          success: false,
          error: `Image URL returned status ${imageResponse.status}`
        });
      }
    } catch (imageError) {
      return res.status(400).json({
        success: false,
        error: `Could not access image URL: ${imageError.message}`
      });
    }
    
    // Get Airtable credentials
    const apiToken = config.airtable?.personalAccessToken || process.env.AIRTABLE_TOKEN;
    const baseId = config.airtable?.baseId || process.env.AIRTABLE_BASE_ID;
    
    if (!apiToken || !baseId) {
      logger.error('Missing Airtable credentials');
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: Missing Airtable credentials'
      });
    }
    
    // Initialize Airtable
    const airtable = new Airtable({ apiKey: apiToken });
    const base = airtable.base(baseId);
    
    // Create timestamp for filenames
    const timestamp = new Date().toISOString().substring(0, 10);
    
    // Create a preview data URL for response
    let previewDataUrl = null;
    
    try {
      // Create canvas for Facebook/Twitter
      const width = 1200;
      const height = 628;
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      
      // Draw black background
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
      
      // Load the source image
      const image = await loadImage(imageUrl);
      
      // Calculate aspect ratios
      const imageAspect = image.width / image.height;
      const canvasAspect = width / height;
      
      let sx, sy, sWidth, sHeight;
      
      if (imageAspect > canvasAspect) {
        // Image is wider than canvas (crop sides)
        sHeight = image.height;
        sWidth = image.height * canvasAspect;
        sy = 0;
        sx = (image.width - sWidth) / 2;
      } else {
        // Image is taller than canvas (crop top/bottom)
        sWidth = image.width;
        sHeight = image.width / canvasAspect;
        sx = 0;
        sy = (image.height - sHeight) / 3; // Crop more from bottom than top
      }
      
      // Draw the image
      ctx.drawImage(image, sx, sy, sWidth, sHeight, 0, 0, width, height);
      
      // Add the logo
      await addLogo(ctx, width, height);
      
      // Use ASCII characters only for maximum compatibility
      const safeTitle = title.replace(/[^\x00-\x7F]/g, ' ');
      const dateStr = new Date().toLocaleDateString('es-ES', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      }).replace(/[^\x00-\x7F]/g, ' ');
      
      // Draw title text with fallback
      drawTextWithFallback(
        ctx,
        safeTitle,
        width / 2,
        height - 60,
        {
          fontSize: Math.floor(width * 0.04),
          color: '#FFFFFF',
          fontWeight: 'bold',
          maxWidth: width * 0.9
        }
      );
      
      // Use current date for the timestamp
      const today = new Date();

      
      // Draw date text with fallback
      drawTextWithFallback(
        ctx,
        dateStr,
        width / 2,
        height - 25,
        {
          fontSize: Math.floor(width * 0.025),
          color: '#cccccc'
        }
      );
      
      // Create a preview data URL
      const previewCanvas = createCanvas(600, 315);
      const previewCtx = previewCanvas.getContext('2d');
      previewCtx.drawImage(canvas, 0, 0, width, height, 0, 0, 600, 315);
      previewDataUrl = previewCanvas.toDataURL('image/jpeg', 1.0);
      
      // Get high-quality buffer for Facebook/Twitter
      const fbtwBaseBuffer = canvas.toBuffer('image/png');
      
      // Create Instagram square image
      let igBaseBuffer;
      
      if (platforms.includes('instagram')) {
        // Create Instagram-specific canvas (square format)
        const instagramCanvas = createCanvas(800, 800);
        const instagramCtx = instagramCanvas.getContext('2d');
        
        // Draw black background
        instagramCtx.fillStyle = '#000000';
        instagramCtx.fillRect(0, 0, 800, 800);
        
        // Draw the image proportionally
        const imgAspect = image.width / image.height;
        
        let ix, iy, iw, ih;
        if (imgAspect > 1) {
          // Image is wider than tall, crop sides
          ih = image.height;
          iw = image.height;
          iy = 0;
          ix = (image.width - iw) / 2;
        } else {
          // Image is taller than wide, crop top/bottom
          iw = image.width;
          ih = image.width;
          ix = 0;
          iy = (image.height - ih) / 2;
        }
        
        // Draw the image
        instagramCtx.drawImage(image, ix, iy, iw, ih, 0, 0, 800, 800);
        
        // Add the logo to Instagram image
        await addLogo(instagramCtx, 800, 800);
        
        // Add solid color background for text
        
        // Draw title text with fallback
        drawTextWithFallback(
          instagramCtx,
          safeTitle,
          400,
          730,
          {
            fontSize: Math.floor(800 * 0.04),
            color: '#FFFFFF',
            fontWeight: 'bold',
            maxWidth: 750
          }
        );
        
        // Draw date text with fallback
        drawTextWithFallback(
          instagramCtx,
          dateStr,
          400,
          770,
          {
            fontSize: Math.floor(800 * 0.025),
            color: '#cccccc'
          }
        );
        
        // Get buffer without text
        igBaseBuffer = instagramCanvas.toBuffer('image/png');
      } else {
        // If Instagram is not in the platforms list, just use the default canvas
        igBaseBuffer = fbtwBaseBuffer;
      }
      
      // Use SVG to add text reliably
      const fbtwBuffer = await createImageWithSVGText(
        fbtwBaseBuffer,
        safeTitle, // This is correct, keep using safeTitle
        dateStr,
        width,
        height
      );
      
      const igBuffer = await createInstagramImageWithSVGText(
        igBaseBuffer,
        safeTitle, // This is correct, keep using safeTitle
        dateStr,
        800,
        800
      );
      
      // Create unique filenames for each platform
      const fbFileName = `facebook-${recordId}-${timestamp}.png`;
      const twFileName = `twitter-${recordId}-${timestamp}.png`;
      const igFileName = `instagram-${recordId}-${timestamp}.png`;
      
      // Upload images to Cloudinary (in parallel)
      const [fbUrl, twUrl, igUrl] = await Promise.all([
        uploadImage(fbtwBuffer, fbFileName),
        uploadImage(fbtwBuffer, twFileName),
        uploadImage(igBuffer, igFileName)
      ]);
      
      // Create update object with Cloudinary URLs
      const updateFields = {
        social_image_facebook: [{
          filename: fbFileName,
          url: fbUrl
        }],
        social_image_twitter: [{
          filename: twFileName,
          url: twUrl
        }],
        social_image_instagram: [{
          filename: igFileName,
          url: igUrl
        }]
      };
      
      // Update Airtable record
      await base('Redes Sociales').update(recordId, updateFields);
      
      // Prepare results for response
      const platformResults = [];
      platformResults.push({
        platform: 'facebook',
        success: true,
        title: title,
        imageUrl: fbUrl
      });
      platformResults.push({
        platform: 'twitter',
        success: true,
        title: title,
        imageUrl: twUrl
      });
      platformResults.push({
        platform: 'instagram',
        success: true,
        title: title,
        imageUrl: igUrl
      });
      
      return res.json({
        success: true,
        message: 'Generated and uploaded social media images for all platforms',
        data: {
          recordId,
          results: platformResults,
          title,
          titleText: safeTitle, // Include the title text
          dateText: dateStr, // Include the date text
          plainText: true, // Flag to indicate plain text rendering
          previewWithTitle: previewDataUrl,
          textPosition: {
            facebook: {
              title: {
                x: width / 2,
                y: height - 60,
                fontSize: Math.floor(width * 0.04),
                maxWidth: width * 0.9
              },
              date: {
                x: width / 2,
                y: height - 25,
                fontSize: Math.floor(width * 0.025)
              }
            },
            instagram: {
              title: {
                x: 400,
                y: 730,
                fontSize: Math.floor(800 * 0.04),
                maxWidth: 750
              },
              date: {
                x: 400,
                y: 770,
                fontSize: Math.floor(800 * 0.025)
              }
            }
          }
        }
      });
    } catch (error) {
      logger.error('Error generating or uploading images:', error);
      
      // Add error results
      const errorResults = platforms.map(platform => ({
        platform,
        success: false,
        error: error.message,
        title: title
      }));
      
      return res.status(500).json({
        success: false,
        error: `Failed to generate images: ${error.message}`,
        data: {
          recordId,
          results: errorResults,
          previewWithTitle: null
        }
      });
    }
  } catch (error) {
    logger.error('Error in generate-all endpoint:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to process request'
    });
  }
});

export default router;