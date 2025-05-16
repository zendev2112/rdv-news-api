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
    
    // Create record fields
    const fields = {
      title: payload.title,
      overline: payload.overline || '',
      excerpt: payload.excerpt || '',
      url: payload.url,
      image: payload.image || [],
      imgUrl: payload.imgUrl || '',
      tags: payload.tags || '',
      socialMediaText: payload.socialMediaText || '',
      source_table: payload.sourceTable || '',
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
    
    // Initialize Airtable
    const airtable = new Airtable({ apiKey: apiToken });
    const base = airtable.base(baseId);
    
    // Create record in Redes Sociales table
    logger.info('Creating record in Redes Sociales table', { fields });
    
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