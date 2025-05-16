import express from 'express';
import { airtableService } from '../../services/index.js';
import logger from '../../utils/logger.js';


const router = express.Router();

/**
 * Webhook handler for social media exports to Redes Sociales table
 * Receives data from Airtable script and creates a record in Redes Sociales table
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
    
    // Create a record in the Redes Sociales table with only specified fields
    const record = {
      fields: {
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
      }
    };
    
    logger.info('Creating record in Redes Sociales table', { record });
    
    // Insert into Airtable Redes Sociales table
    const result = await airtableService.insertRecords(
      [record], 
      'Redes Sociales' // The actual table name in Airtable
    );
    
    logger.info('Social media export successful', { result });
    
    return res.json({
      success: true,
      message: 'Content successfully exported to Redes Sociales',
      data: result.length > 0 ? result[0] : {}
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