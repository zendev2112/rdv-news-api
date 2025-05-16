import express from 'express';
import Airtable from 'airtable';
import config from '../../config/index.js';
import logger from '../../utils/logger.js';

const router = express.Router();

/**
 * Webhook handler for social media exports to Redes Sociales table
 */
router.post('/social-media', async (req, res) => {
  try {
    const payload = req.body;
    logger.info('Received social media export request', { payload });
    
    // Validate required fields
    const requiredFields = ['title', 'url'];
    const missingFields = requiredFields.filter(field => !payload[field]);
    
    if (missingFields.length > 0) {
      logger.warn('Missing required fields for social media export', { missingFields });
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missingFields.join(', ')}`
      });
    }
    
    // Process image attachments - convert Airtable attachment objects to URL-only format
    let processedImage = [];
    if (payload.image && Array.isArray(payload.image)) {
      processedImage = payload.image.map(img => {
        // If it's already in the simple URL format
        if (typeof img === 'string') {
          return { url: img };
        }
        
        // If it's an Airtable attachment object
        if (img.url) {
          return { url: img.url };
        }
        
        return img;
      });
    } else if (payload.imgUrl) {
      // If no image array but imgUrl exists
      processedImage = [{ url: payload.imgUrl }];
    }
    
    // Create record fields
    const fields = {
      title: payload.title,
      overline: payload.overline || '',
      excerpt: payload.excerpt || '',
      url: payload.url,
      image: processedImage, // Use the processed image array
      imgUrl: payload.imgUrl || '',
      tags: payload.tags || '',
      socialMediaText: payload.socialMediaText || '',
      section: payload.section || '', // Use section instead of source_table
      created_at: new Date().toISOString()
    };
    
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
    
    // Log the processed fields for debugging
    logger.info('Processed fields for Redes Sociales', { 
      title: fields.title,
      section: fields.section,
      imageCount: processedImage.length
    });
    
    // Initialize Airtable
    const airtable = new Airtable({ apiKey: apiToken });
    const base = airtable.base(baseId);
    
    // Create record in Redes Sociales table
    logger.info('Creating record in Redes Sociales table');
    
    const result = await base('Redes Sociales').create([{ fields }]);
    
    logger.info('Social media export successful', { result });
    
    return res.json({
      success: true,
      message: 'Content successfully exported to Redes Sociales',
      data: result[0]
    });
  } catch (error) {
    logger.error('Error exporting to Redes Sociales', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to export content to Redes Sociales'
    });
  }
});

export default router;