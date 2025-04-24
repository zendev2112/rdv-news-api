import express from 'express';
import airtableService from '../services/airtable.js';
import supabaseService from '../services/supabase.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * GET handler for webhook endpoint - for testing/documentation purposes
 */
router.get('/airtable/publish', (req, res) => {
  logger.info('GET request received on webhook endpoint');
  res.json({
    status: 'online',
    message: 'Webhook endpoint is ready for POST requests',
    usage: {
      method: 'POST',
      contentType: 'application/json',
      body: {
        recordId: 'required - Airtable record ID',
        sectionId: 'optional - defaults to primera-plana'
      }
    }
  });
});

/**
 * Webhook endpoint to receive publish events from Airtable
 * This is triggered when the "publish" button is clicked in Airtable
 */
router.post('/airtable/publish', async (req, res) => {
  try {
    logger.info('Received publish webhook from Airtable');
    logger.debug('Webhook payload:', req.body);
    
    // Extract record ID and section ID from the webhook payload
    const recordId = req.body.recordId || 
                    (req.body.record && req.body.record.id) || 
                    (req.body.payload && req.body.payload.recordId);
    
    const sectionId = req.body.sectionId || 
                     (req.body.payload && req.body.payload.sectionId) || 
                     'primera-plana'; // Default if not specified
    
    if (!recordId) {
      logger.error('No record ID found in webhook payload');
      return res.status(400).json({ success: false, error: 'No record ID provided' });
    }
    
    logger.info(`Fetching Airtable record ${recordId} from section ${sectionId}`);
    
    // Get the full record from Airtable
    const record = await airtableService.getRecord(recordId, sectionId);
    
    if (!record) {
      logger.error(`Record ${recordId} not found in Airtable section ${sectionId}`);
      return res.status(404).json({ success: false, error: 'Record not found' });
    }
    
    // Publish the record to Supabase
    const result = await supabaseService.publishArticle(record);
    
    if (!result.success) {
      logger.error(`Failed to publish record ${recordId} to Supabase: ${result.error}`);
      return res.status(500).json({ success: false, error: result.error });
    }
    
    logger.info(`Successfully published record ${recordId} to Supabase`);
    
    // Return success response
    return res.json({
      success: true,
      message: `Record ${recordId} successfully published to Supabase`,
      data: result.data
    });
    
  } catch (error) {
    logger.error('Error handling publish webhook:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;