import express from 'express';
import Airtable from 'airtable';
import imageGenerator from '../services/image-generator.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// Test GET endpoint
router.get('/generate', (req, res) => {
  res.json({
    success: true,
    message: 'The social media image generator endpoint is working',
    usage: 'Send a POST request to this endpoint with recordId, imageUrl, and title in the request body',
    examples: {
      singlePlatform: {
        method: 'POST',
        body: {
          recordId: 'rec123',
          imageUrl: 'https://example.com/image.jpg',
          title: 'Your post title',
          platform: 'facebook' // Optional, defaults to 'generic'
        }
      },
      allPlatforms: {
        endpoint: '/api/social-media-images/generate-all',
        method: 'POST',
        body: {
          recordId: 'rec123',
          imageUrl: 'https://example.com/image.jpg',
          title: 'Your post title'
        }
      }
    }
  });
});

// Basic test endpoint to verify router is accessible
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
      
      const contentType = imageResponse.headers.get('content-type');
      if (!contentType || !contentType.startsWith('image/')) {
        return res.status(400).json({
          success: false,
          error: `URL does not appear to be an image (content-type: ${contentType})`
        });
      }
    } catch (imageError) {
      return res.status(400).json({
        success: false,
        error: `Could not access image URL: ${imageError.message}`
      });
    }
    
    // Generate the image
    logger.info('Calling image generator service');
    const imageBuffer = await imageGenerator.generateSocialMediaImage({
      imageUrl,
      title,
      platform
    });
    
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
    
    // Convert buffer to base64 for Airtable
    const base64Image = imageBuffer.toString('base64');
    
    // Create file name with platform and timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `social-${platform}-${timestamp}.jpg`;
    
    // Update the record in Airtable with the new image
    // Store the image in a field named "social_image_[platform]"
    const updateFields = {};
    
    // Add to the platform-specific field
    updateFields[`social_image_${platform.toLowerCase()}`] = [
      {
        filename: fileName,
        content: base64Image,
        type: 'image/jpeg'
      }
    ];
    
    // Also add to a general "social_images" field that collects all generated images
    try {
      // First get the current record to see if social_images already exists
      const record = await base('Redes Sociales').find(recordId);
      const existingSocialImages = record.fields.social_images || [];
      
      // Add the new image to the collection
      updateFields.social_images = [
        ...existingSocialImages,
        {
          filename: fileName,
          content: base64Image,
          type: 'image/jpeg'
        }
      ];
    } catch (err) {
      // If there's an error getting the record, just set the new image
      updateFields.social_images = [
        {
          filename: fileName,
          content: base64Image,
          type: 'image/jpeg'
        }
      ];
    }
    
    // Update the record
    await base('Redes Sociales').update(recordId, updateFields);
    
    return res.json({
      success: true,
      message: `Generated and attached social media image for ${platform}`,
      data: {
        recordId,
        platform,
        fileName
      }
    });
    
  } catch (error) {
    // Improved error logging
    logger.error('Error details:', error);
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
    
    for (const platform of platforms) {
      try {
        // Generate image for this platform
        const imageBuffer = await imageGenerator.generateSocialMediaImage({
          imageUrl,
          title,
          platform
        });
        
        // Create file name
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `social-${platform}-${timestamp}.jpg`;
        
        // Convert to base64
        const base64Image = imageBuffer.toString('base64');
        
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
    await base('Redes Sociales').update(recordId, updateFields);
    
    return res.json({
      success: true,
      message: 'Generated and attached social media images',
      data: {
        recordId,
        results
      }
    });
    
  } catch (error) {
    logger.error('Error generating social media images:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate social media images'
    });
  }
});

export default router;