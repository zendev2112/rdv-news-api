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
    
    // Generate a properly sized image for Airtable (smaller size to avoid attachment limits)
    logger.info('Calling image generator service with optimized size for Airtable');
    const { createCanvas, loadImage } = await import('canvas');
    
    // Define dimensions based on platform but keep them smaller for Airtable
    let width, height;
    switch (platform.toLowerCase()) {
      case 'instagram':
        width = 600;
        height = 600; // Square format
        break;
      case 'twitter':
      case 'x':
        width = 600;
        height = 337; // 16:9 ratio
        break;
      case 'facebook':
        width = 600;
        height = 314; // Recommended for sharing
        break;
      default:
        width = 600;
        height = 314; // Default format
    }
    
    // Create canvas with the specified dimensions
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Draw solid background as fallback
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    
    try {
      // Load the source image
      const image = await loadImage(imageUrl);
      
      // Calculate aspect ratios to ensure proper fit
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
      
      // Draw the image with proper cropping
      ctx.drawImage(image, sx, sy, sWidth, sHeight, 0, 0, width, height);
      
      // Add a semi-transparent overlay for better text visibility
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.fillRect(0, 0, width, height);
      
      // Add the title text
      const formattedTitle = title.length > 100 ? title.substring(0, 97) + '...' : title;
      
      ctx.font = `bold ${Math.floor(width * 0.05)}px Arial, sans-serif`;
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      // Simple text wrapping
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
      
      // Draw each line
      const lineHeight = Math.floor(width * 0.055);
      const totalTextHeight = lineHeight * lines.length;
      const startY = (height / 2) - (totalTextHeight / 2) + (height * 0.05);
      
      lines.forEach((line, i) => {
        const y = startY + (i * lineHeight);
        ctx.fillText(line, width / 2, y);
      });
    } catch (drawError) {
      logger.error('Error drawing image:', drawError);
      // Continue with just the text on black background
      
      // Draw the title text
      ctx.font = `bold 24px Arial, sans-serif`;
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(title.substring(0, 50), width / 2, height / 2);
    }
    
    // Get the image as a buffer with reduced quality to keep size down
    const imageBuffer = canvas.toBuffer('image/jpeg', { quality: 0.8 });
    
    // Convert to base64 for Airtable
    const base64Image = imageBuffer.toString('base64');
    
    // Create file name
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `social-${platform}-${timestamp}.jpg`;
    
    // Initialize Airtable
    const airtable = new Airtable({ apiKey: apiToken });
    const base = airtable.base(baseId);
    
    // Update the record in Airtable
    const updateFields = {};
    
    // Create the attachment object
    const attachment = {
      filename: fileName,
      content: base64Image,
      type: 'image/jpeg'
    };
    
    // Add to platform-specific field
    updateFields[`social_image_${platform.toLowerCase()}`] = [attachment];
    
    // Also update the social_images field if it exists
    try {
      // First check if the record exists and get current social_images
      const record = await base('Redes Sociales').find(recordId);
      const existingSocialImages = record.fields.social_images || [];
      
      // Add to existing images
      updateFields.social_images = [
        ...existingSocialImages,
        attachment
      ];
    } catch (recordError) {
      // If record find fails, just set the new image
      updateFields.social_images = [attachment];
    }
    
    // Update Airtable
    try {
      await base('Redes Sociales').update(recordId, updateFields);
      
      return res.json({
        success: true,
        message: `Generated and attached social media image for ${platform}`,
        data: {
          recordId,
          platform,
          fieldName: `social_image_${platform.toLowerCase()}`
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
    const allSocialImages = [];
    
    const { createCanvas, loadImage } = await import('canvas');
    
    for (const platform of platforms) {
      try {
        // Define dimensions based on platform
        let width, height;
        switch (platform.toLowerCase()) {
          case 'instagram':
            width = 600;
            height = 600; // Square format
            break;
          case 'twitter':
          case 'x':
            width = 600;
            height = 337; // 16:9 ratio
            break;
          case 'facebook':
            width = 600;
            height = 314; // Recommended for sharing
            break;
          default:
            width = 600;
            height = 314; // Default format
        }
        
        // Create canvas with the specified dimensions
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        
        // Draw solid background as fallback
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);
        
        try {
          // Load the source image
          const image = await loadImage(imageUrl);
          
          // Calculate aspect ratios to ensure proper fit
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
          
          // Draw the image with proper cropping
          ctx.drawImage(image, sx, sy, sWidth, sHeight, 0, 0, width, height);
          
          // Add a semi-transparent overlay for better text visibility
          ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
          ctx.fillRect(0, 0, width, height);
          
          // Add the title text
          const formattedTitle = title.length > 100 ? title.substring(0, 97) + '...' : title;
          
          ctx.font = `bold ${Math.floor(width * 0.05)}px Arial, sans-serif`;
          ctx.fillStyle = '#FFFFFF';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          // Simple text wrapping
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
          
          // Draw each line
          const lineHeight = Math.floor(width * 0.055);
          const totalTextHeight = lineHeight * lines.length;
          const startY = (height / 2) - (totalTextHeight / 2) + (height * 0.05);
          
          lines.forEach((line, i) => {
            const y = startY + (i * lineHeight);
            ctx.fillText(line, width / 2, y);
          });
        } catch (drawError) {
          logger.error(`Error drawing image for ${platform}:`, drawError);
          // Just draw text on black background
          ctx.font = `bold 24px Arial, sans-serif`;
          ctx.fillStyle = '#FFFFFF';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(title.substring(0, 50), width / 2, height / 2);
        }
        
        // Get the image as a buffer with reduced quality
        const imageBuffer = canvas.toBuffer('image/jpeg', { quality: 0.8 });
        
        // Convert to base64 for Airtable
        const base64Image = imageBuffer.toString('base64');
        
        // Create file name
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `social-${platform}-${timestamp}.jpg`;
        
        // Create attachment object
        const attachment = {
          filename: fileName,
          content: base64Image,
          type: 'image/jpeg'
        };
        
        // Add to platform-specific field
        updateFields[`social_image_${platform}`] = [attachment];
        
        // Add to collection of all images
        allSocialImages.push(attachment);
        
        results.push({
          platform,
          success: true
        });
      } catch (platformError) {
        logger.error(`Error generating ${platform} image:`, platformError);
        results.push({
          platform,
          success: false,
          error: platformError.message
        });
      }
    }
    
    // Add all images to the social_images field
    if (allSocialImages.length > 0) {
      updateFields.social_images = allSocialImages;
    }
    
    // Update the record in Airtable
    try {
      await base('Redes Sociales').update(recordId, updateFields);
      
      return res.json({
        success: true,
        message: 'Generated and attached social media images',
        data: {
          recordId,
          results
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
    logger.error('Error generating social media images:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate social media images'
    });
  }
});

export default router;