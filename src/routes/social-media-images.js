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

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Create fonts directory if needed
const fontDir = path.join(__dirname, '../../assets/fonts');
if (!fs.existsSync(fontDir)) {
  fs.mkdirSync(fontDir, { recursive: true });
}

// Try multiple font registration approaches
let fontRegistered = false;

// First try project bundled fonts (if they exist)
const fontPath = path.join(fontDir, 'Arial.ttf');
const fontPathBold = path.join(fontDir, 'Arial-Bold.ttf');

try {
  if (fs.existsSync(fontPath)) {
    registerFont(fontPath, { family: 'Arial' });
    fontRegistered = true;
    logger.info('Registered bundled Arial font');
  }
} catch (err) {
  logger.warn('Failed to register bundled font:', err.message);
}

// Then try system fonts
if (!fontRegistered) {
  try {
    // Try to register system fonts if possible
    registerFont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', { family: 'DejaVuSans' });
    registerFont('/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', { family: 'LiberationSans' });
    fontRegistered = true;
    logger.info('Registered system fonts');
  } catch (err) {
    logger.warn('Could not register system fonts:', err.message);
  }
}

// Last resort - register a fake font to avoid errors
if (!fontRegistered) {
  try {
    logger.warn('No fonts registered, using node-canvas built-in fonts');
  } catch (err) {
    logger.error('Font registration completely failed:', err.message);
  }
}

/**
 * Download and register a Google font for reliable text rendering
 */
async function setupReliableFonts() {
  try {
    // Check if we already have the font
    const robotoRegularPath = path.join(fontDir, 'Roboto-Regular.ttf');
    const robotoBoldPath = path.join(fontDir, 'Roboto-Bold.ttf');
    
    // Download fonts if they don't exist
    if (!fs.existsSync(robotoRegularPath)) {
      logger.info('Downloading Roboto Regular font...');
      const regularResponse = await fetch('https://github.com/google/fonts/raw/main/apache/roboto/Roboto-Regular.ttf');
      if (regularResponse.ok) {
        const buffer = await regularResponse.arrayBuffer();
        fs.writeFileSync(robotoRegularPath, Buffer.from(buffer));
        logger.info('Roboto Regular font downloaded successfully');
      }
    }
    
    if (!fs.existsSync(robotoBoldPath)) {
      logger.info('Downloading Roboto Bold font...');
      const boldResponse = await fetch('https://github.com/google/fonts/raw/main/apache/roboto/Roboto-Bold.ttf');
      if (boldResponse.ok) {
        const buffer = await boldResponse.arrayBuffer();
        fs.writeFileSync(robotoBoldPath, Buffer.from(buffer));
        logger.info('Roboto Bold font downloaded successfully');
      }
    }
    
    // Register the fonts
    if (fs.existsSync(robotoRegularPath)) {
      registerFont(robotoRegularPath, { family: 'Roboto' });
      logger.info('Registered Roboto Regular font');
    }
    
    if (fs.existsSync(robotoBoldPath)) {
      registerFont(robotoBoldPath, { family: 'Roboto', weight: 'bold' });
      logger.info('Registered Roboto Bold font');
    }
    
    return true;
  } catch (error) {
    logger.error('Error setting up reliable fonts:', error);
    return false;
  }
}

// Call this function before defining your routes
await setupReliableFonts();

// Create images directory if needed
const imagesDir = path.join(__dirname, '../../assets/images');
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

// Check if ImageMagick is installed
let imagemagickAvailable = false;
try {
  const { stdout } = await execAsync('which convert');
  if (stdout) {
    imagemagickAvailable = true;
    logger.info('ImageMagick detected, will use for text rendering');
  } else {
    logger.warn('ImageMagick not found in PATH');
  }
} catch (error) {
  logger.warn('ImageMagick not installed or accessible:', error.message);
}

/**
 * Create text image using ImageMagick and return the path to the temporary file
 * @param {string} text - Text to render
 * @param {number} width - Width of the text image
 * @param {object} options - Text options (fontSize, color, etc)
 * @returns {Promise<string>} Path to the created text image
 */
async function createTextImage(text, width, options = {}) {
  // If ImageMagick is not available, throw an error to fall back to character-by-character rendering
  if (!imagemagickAvailable) {
    throw new Error('ImageMagick not available');
  }
  
  try {
    const {
      fontSize = 40,
      color = 'white',
      bgColor = 'none',
      fontWeight = 'bold',
      fontFamily = 'Arial'
    } = options;
    
    // Strip special characters for safety in shell command
    const safeText = text
      .replace(/[^\x00-\x7F]/g, '') // ASCII only
      .replace(/["'`]/g, '') // Remove quotes
      .replace(/\\/g, ''); // Remove backslashes
    
    // Create temporary file path
    const tempFile = path.join(os.tmpdir(), `text-${Date.now()}.png`);
    
    // Construct ImageMagick command for transparent background with text
    // Simplified command that should work on most systems
    const command = `convert -size ${width}x -background ${bgColor} -fill ${color} -gravity center caption:"${safeText}" "${tempFile}"`;
    
    // Execute the command
    logger.info(`Executing ImageMagick command for text: ${safeText.substring(0, 20)}...`);
    const { stderr } = await execAsync(command);
    
    if (stderr) {
      logger.warn('ImageMagick warning:', stderr);
    }
    
    // Verify the file was created
    if (!fs.existsSync(tempFile)) {
      throw new Error('ImageMagick did not create the text image file');
    }
    
    logger.info(`Created text image at ${tempFile}`);
    return tempFile;
  } catch (error) {
    logger.error('Error creating text image with ImageMagick:', error);
    throw error;
  }
}

/**
 * Direct text rendering on canvas with special handling to ensure visibility
 */
function renderTextDirectly(ctx, text, x, y, options = {}) {
  const {
    fontSize = 24,
    fontFamily = 'Roboto, Arial, sans-serif',
    color = '#FFFFFF',
    bold = false,
    maxWidth = null
  } = options;
  
  // Save current state
  ctx.save();
  
  // Create background shape for text
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  const bgPadding = fontSize * 0.5;
  const textWidth = maxWidth || (text.length * fontSize * 0.6);
  ctx.fillRect(x - textWidth/2 - bgPadding, y - fontSize - bgPadding, 
               textWidth + bgPadding*2, fontSize*2 + bgPadding);
  
  // Set text style
  ctx.font = `${bold ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // Draw text
  ctx.fillText(text, x, y, maxWidth);
  
  // Restore state
  ctx.restore();
  
  return true;
}

/**
 * Add logo to the canvas
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @returns {Promise<void>}
 */
async function addLogo(ctx, width, height) {
  try {
    // Path to the logo file - update this with your actual logo filename
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
    } else {
      logger.warn(`Logo not found at ${logoPath}`);
    }
  } catch (error) {
    logger.error('Error adding logo:', error);
  }
}

const router = express.Router();

// Define the roundRect function outside of your route handlers so it's available everywhere
function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  ctx.fill();
}

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
      
      // Add a solid color background for text (more opaque)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
      ctx.fillRect(0, height - 120, width, 120);
      
      // Use ASCII characters only for maximum compatibility
      const safeTitle = title.replace(/[^\x00-\x7F]/g, '');
      const shortTitle = safeTitle.length > 60 ? safeTitle.substring(0, 57) + '...' : safeTitle;
      
      // Add ASCII-only date
      const today = new Date();
      const dateStr = today.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric', 
        year: 'numeric'
      }).replace(/[^\x00-\x7F]/g, '');
      
      // Since we've had persistent issues with text rendering, directly render the text
      // with simpler but more reliable approach:
      
      // Draw title text
      renderTextDirectly(ctx, shortTitle, width / 2, height - 60, {
        fontSize: Math.floor(width * 0.04),
        bold: true,
        maxWidth: width * 0.9
      });
      
      // Draw date text
      renderTextDirectly(ctx, dateStr, width / 2, height - 25, {
        fontSize: Math.floor(width * 0.02)
      });
      
    } catch (drawError) {
      logger.error('Error drawing image:', drawError);
      
      // Just draw title text on black background
      ctx.font = `bold 24px sans-serif`;
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(title.substring(0, 50), width / 2, height / 2);
    }
    
    // Get the high-quality preview image for the response
    const previewDataUrl = canvas.toDataURL('image/jpeg', 0.9);
    
    // Initialize Airtable
    const airtable = new Airtable({ apiKey: apiToken });
    const base = airtable.base(baseId);
    
    // Create a timestamp for filenames
    const timestamp = new Date().toISOString().substring(0, 10);
    
    try {
      // Get high-quality buffer for Cloudinary
      const uploadBuffer = canvas.toBuffer('image/jpeg', { quality: 0.85 });
      
      // Upload to Cloudinary
      const fileName = `${platform.toLowerCase()}-${recordId}-${timestamp}.jpg`;
      const publicUrl = await uploadImage(uploadBuffer, fileName);
      
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
          imageUrl: publicUrl
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
      
      // Add a solid color background for text (more opaque)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
      ctx.fillRect(0, height - 120, width, 120);
      
      // Use ASCII characters only for maximum compatibility
      const safeTitle = title.replace(/[^\x00-\x7F]/g, '');
      const shortTitle = safeTitle.length > 60 ? safeTitle.substring(0, 57) + '...' : safeTitle;
      
      // Create date string 
      const today = new Date();
      const dateStr = today.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric', 
        year: 'numeric'
      }).replace(/[^\x00-\x7F]/g, '');
      
      // Directly render the text using our simplified approach
      renderTextDirectly(ctx, shortTitle, width / 2, height - 60, {
        fontSize: Math.floor(width * 0.04),
        bold: true,
        maxWidth: width * 0.9
      });
      
      // Draw date text
      renderTextDirectly(ctx, dateStr, width / 2, height - 25, {
        fontSize: Math.floor(width * 0.02)
      });
      
      // Create a preview data URL
      const previewCanvas = createCanvas(600, 315);
      const previewCtx = previewCanvas.getContext('2d');
      previewCtx.drawImage(canvas, 0, 0, width, height, 0, 0, 600, 315);
      previewDataUrl = previewCanvas.toDataURL('image/jpeg', 0.8);
      
      // Get high-quality buffer for Facebook/Twitter
      const fbtwBuffer = canvas.toBuffer('image/jpeg', { quality: 0.85 });
      
      // Create Instagram square image if needed
      let igBuffer;
      
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
        instagramCtx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        instagramCtx.fillRect(0, 680, 800, 120);
        
        // Draw Instagram text with direct rendering approach
        renderTextDirectly(instagramCtx, shortTitle, 400, 730, {
          fontSize: Math.floor(800 * 0.04),
          bold: true,
          maxWidth: 700
        });
        
        // Draw date text
        renderTextDirectly(instagramCtx, dateStr, 400, 770, {
          fontSize: Math.floor(800 * 0.02)
        });
        
        // Get Instagram buffer for Cloudinary
        igBuffer = instagramCanvas.toBuffer('image/jpeg', { quality: 0.85 });
      } else {
        // If Instagram is not in the platforms list, just use the default canvas
        igBuffer = canvas.toBuffer('image/jpeg', { quality: 0.85 });
      }
      
      // Create unique filenames for each platform
      const fbFileName = `facebook-${recordId}-${timestamp}.jpg`;
      const twFileName = `twitter-${recordId}-${timestamp}.jpg`;
      const igFileName = `instagram-${recordId}-${timestamp}.jpg`;
      
      // Upload images to Cloudinary (in parallel for speed)
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
          previewWithTitle: previewDataUrl
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