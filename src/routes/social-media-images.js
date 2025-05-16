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
    
    // Generate the image preview (this doesn't get saved, but can be used in frontend)
    logger.info('Generating image preview with title overlay');
    const { createCanvas, loadImage } = await import('canvas');
    
    // Use better dimensions for preview image
    let width, height;
    switch (platform.toLowerCase()) {
      case 'instagram':
        width = 600;
        height = 600; // Square format
        break;
      case 'twitter':
        width = 600;
        height = 335; // 16:9 ratio
        break;
      case 'facebook':
        width = 600;
        height = 314; // Recommended for sharing
        break;
      default:
        width = 600;
        height = 314; // Default format
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
      
      // Add overlay gradient for better text readability
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0.6)');
      gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.3)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      
      // Add platform badge in the corner
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px Arial';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(platform.toUpperCase(), 20, 20);
      
      // Add title text
      const formattedTitle = title.length > 100 ? title.substring(0, 97) + '...' : title;
      
      // Calculate font size based on canvas width
      const fontSize = Math.floor(width * 0.05);
      ctx.font = `bold ${fontSize}px Arial`;
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      // Text wrapping
      const words = formattedTitle.split(' ');
      const lines = [];
      let currentLine = words[0];
      
      const maxLineWidth = width * 0.8; // 80% of canvas width
      
      for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const testLine = currentLine + ' ' + word;
        const metrics = ctx.measureText(testLine);
        
        if (metrics.width > maxLineWidth) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      lines.push(currentLine);
      
      // Draw each line of text
      const lineHeight = fontSize * 1.2;
      const totalTextHeight = lineHeight * lines.length;
      const startY = (height / 2) - (totalTextHeight / 2);
      
      lines.forEach((line, i) => {
        const y = startY + (i * lineHeight);
        ctx.fillText(line, width / 2, y);
      });
      
    } catch (drawError) {
      logger.error('Error drawing image:', drawError);
      
      // Just draw title text on black background
      ctx.font = 'bold 24px Arial';
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(title.substring(0, 50), width / 2, height / 2);
    }
    
    // Get the preview image as a data URL for the response
    const previewDataUrl = canvas.toDataURL('image/jpeg');
    
    // Initialize Airtable
    const airtable = new Airtable({ apiKey: apiToken });
    const base = airtable.base(baseId);
    
    // Create a timestamp for filenames
    const timestamp = new Date().toISOString().substring(0, 10);
    const fileName = `${platform}-${timestamp}.jpg`;
    
    try {
      // Create update object with correct field name for the specified platform
      const updateFields = {};
      
      // Use the correct field name based on platform
      if (platform.toLowerCase() === 'instagram') {
        updateFields.social_image_instagram = [{
          url: imageUrl,
          filename: fileName
        }];
      } else if (platform.toLowerCase() === 'twitter') {
        updateFields.social_image_twitter = [{
          url: imageUrl,
          filename: fileName
        }];
      } else if (platform.toLowerCase() === 'facebook') {
        updateFields.social_image_facebook = [{
          url: imageUrl,
          filename: fileName
        }];
      } else {
        // Generic/default platform - update all fields
        updateFields.social_image_instagram = [{
          url: imageUrl,
          filename: `instagram-${timestamp}.jpg`
        }];
        updateFields.social_image_twitter = [{
          url: imageUrl,
          filename: `twitter-${timestamp}.jpg`
        }];
        updateFields.social_image_facebook = [{
          url: imageUrl,
          filename: `facebook-${timestamp}.jpg`
        }];
      }
      
      // Update Airtable record
      await base('Redes Sociales').update(recordId, updateFields);
      
      return res.json({
        success: true,
        message: `Attached image for ${platform}`,
        data: {
          recordId,
          platform,
          imageUrl: imageUrl,
          previewWithTitle: previewDataUrl // Send the preview image with title overlay
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
      
      // Prepare update fields using correct field names
      updateFields.social_image_facebook = [{
        url: imageUrl,
        filename: `facebook-${timestamp}.jpg`
      }];
      
      updateFields.social_image_twitter = [{
        url: imageUrl,
        filename: `twitter-${timestamp}.jpg`
      }];
      
      updateFields.social_image_instagram = [{
        url: imageUrl,
        filename: `instagram-${timestamp}.jpg`
      }];
      
      platforms.forEach(platform => {
        results.push({
          platform,
          success: true,
          imageUrl: imageUrl
        });
      });
      
      // Generate a preview image for the response (using Twitter dimensions)
      const { createCanvas, loadImage } = await import('canvas');
      let previewDataUrl = null;
      
      try {
        const width = 600;
        const height = 335;
        
        // Create canvas
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
        
        // Add overlay gradient for better text readability
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0.6)');
        gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.3)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        
        // Add "Social Media" badge in the corner
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('SOCIAL MEDIA', 20, 20);
        
        // Add title text
        const formattedTitle = title.length > 100 ? title.substring(0, 97) + '...' : title;
        
        // Calculate font size based on canvas width
        const fontSize = Math.floor(width * 0.05);
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Text wrapping
        const words = formattedTitle.split(' ');
        const lines = [];
        let currentLine = words[0];
        
        const maxLineWidth = width * 0.8; // 80% of canvas width
        
        for (let i = 1; i < words.length; i++) {
          const word = words[i];
          const testLine = currentLine + ' ' + word;
          const metrics = ctx.measureText(testLine);
          
          if (metrics.width > maxLineWidth) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        }
        lines.push(currentLine);
        
        // Draw each line of text
        const lineHeight = fontSize * 1.2;
        const totalTextHeight = lineHeight * lines.length;
        const startY = (height / 2) - (totalTextHeight / 2);
        
        lines.forEach((line, i) => {
          const y = startY + (i * lineHeight);
          ctx.fillText(line, width / 2, y);
        });
        
        previewDataUrl = canvas.toDataURL('image/jpeg');
      } catch (previewError) {
        logger.error('Error creating preview image:', previewError);
      }
      
      // Update the record in Airtable with all social media images
      try {
        await base('Redes Sociales').update(recordId, updateFields);
        
        return res.json({
          success: true,
          message: 'Attached social media images for all platforms',
          data: {
            recordId,
            results,
            imageUrl,
            previewWithTitle: previewDataUrl
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