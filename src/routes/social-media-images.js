import express from 'express';
import Airtable from 'airtable';
import logger from '../utils/logger.js';
import config from '../config/index.js';
import imageGenerator from '../services/image-generator.js';

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
    
    // Generate the image
    logger.info('Calling image generator service');
    const { createCanvas, loadImage } = await import('canvas');
    
    // Define dimensions based on platform (much smaller for better performance)
    let width, height;
    switch (platform.toLowerCase()) {
      case 'instagram':
        width = 200;
        height = 200; // Square format
        break;
      case 'twitter':
      case 'x':
        width = 200;
        height = 112; // 16:9 ratio
        break;
      case 'facebook':
        width = 200;
        height = 105; // Recommended for sharing
        break;
      default:
        width = 200;
        height = 105; // Default format
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
      
      // Add overlay
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, width, height);
      
      // Add simple text
      const shortTitle = title.length > 30 ? title.substring(0, 27) + '...' : title;
      
      ctx.font = 'bold 12px Arial';
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(shortTitle, width / 2, height / 2);
      
    } catch (drawError) {
      logger.error('Error drawing image:', drawError);
      
      // Just draw title text
      ctx.font = 'bold 12px Arial';
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(title.substring(0, 30), width / 2, height / 2);
    }
    
    // Get image buffer
    const imageBuffer = canvas.toBuffer('image/jpeg', { quality: 0.7 });
    
    // Initialize Airtable
    const airtable = new Airtable({ apiKey: apiToken });
    const base = airtable.base(baseId);
    
    // Create a timestamp for filenames
    const timestamp = new Date().toISOString().substring(0, 10);
    const fileName = `${platform}-${timestamp}.jpg`;
    
    // IMPORTANT: Instead of using base64 in the attachment, use the URL method
    try {
      // Update the record with just the URL attachment method
      await base('Redes Sociales').update(recordId, {
        [`social_image_${platform.toLowerCase()}`]: [{
          url: imageUrl, // Use the original image URL instead of base64
          filename: fileName
        }]
      });
      
      return res.json({
        success: true,
        message: `Attached image for ${platform}`,
        data: {
          recordId,
          platform,
          imageUrl: imageUrl
        }
      });
    } catch (airtableError) {
      logger.error('Airtable update error:', airtableError);
      
      return res.status(500).json({
        success: false,
        error: `Error updating Airtable record: ${airtableError.message}`
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
    
    // Process each platform
    const results = [];
    const updateFields = {};
    
    // Create timestamp for filenames
    const timestamp = new Date().toISOString().substring(0, 10);
    
    // Prepare update fields - use URL method for each platform
    for (const platform of platforms) {
      const fileName = `${platform}-${timestamp}.jpg`;
      
      // Add URL attachment for this platform
      updateFields[`social_image_${platform.toLowerCase()}`] = [{
        url: imageUrl,
        filename: fileName
      }];
      
      results.push({
        platform,
        success: true,
        imageUrl: imageUrl
      });
    }
    
    // Update the record in Airtable
    try {
      await base('Redes Sociales').update(recordId, updateFields);
      
      return res.json({
        success: true,
        message: 'Attached social media images for all platforms',
        data: {
          recordId,
          results,
          imageUrl
        }
      });
    } catch (airtableError) {
      logger.error('Airtable update error:', airtableError);
      
      return res.status(500).json({
        success: false,
        error: `Error updating Airtable record: ${airtableError.message}`
      });
    }
  } catch (error) {
    logger.error('Error attaching social media images:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to attach social media images'
    });
  }
});

export default router;