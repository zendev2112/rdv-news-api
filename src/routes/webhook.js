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
    
    // Extract record ID and section ID from the webhook payload
    const recordId = req.body.recordId;
    const sectionId = req.body.tableName || req.body.sectionId;
    
    // Special handling for forced section (used for Instituciones)
    const forceSection = req.body.forceSection;
    const forceSectionId = req.body.forceSectionId;
    const isInstituciones = req.body.isInstituciones;
    
    // Validate input
    if (!recordId) {
      logger.error('No record ID provided');
      return res.status(400).json({ success: false, error: 'Missing recordId parameter' });
    }
    
    if (!sectionId) {
      logger.error('No section ID or table name provided');
      return res.status(400).json({ success: false, error: 'Missing sectionId or tableName parameter' });
    }
    
    logger.info(`Fetching Airtable record ${recordId} from section ${sectionId}`);
    
    // Get the record from Airtable
    const record = await airtableService.getRecord(recordId, sectionId);
    
    if (!record) {
      logger.error(`Record not found: ${recordId}`);
      return res.status(404).json({ success: false, error: 'Record not found' });
    }
    
    // Add section overrides if forced
    if (forceSection) {
      record.forceSection = forceSection;
    }
    if (forceSectionId) {
      record.forceSectionId = forceSectionId;
    }
    if (isInstituciones) {
      record.isInstituciones = true;
    }
    
    // Add source section ID to the record for reference
    record.sourceSectionId = sectionId;
    
    // Publish to Supabase
    const result = await supabaseService.publishArticle(record);
    
    if (!result.success) {
      logger.error(`Failed to publish: ${result.error}`);
      return res.status(500).json(result);
    }
    
    // Success!
    logger.info(`Published record ${recordId} successfully`);
    return res.json(result);
    
  } catch (error) {
    logger.error('Error in webhook handler:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;