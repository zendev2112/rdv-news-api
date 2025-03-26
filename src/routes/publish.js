const express = require('express');
const router = express.Router();
const supabaseService = require('../services/supabase');
const airtableService = require('../services/airtable');
const { logError } = require('../utils/error-logging');

// Add this at the beginning of your file, after the initial imports
router.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'API is running'
  });
});

/**
 * Publish article from Airtable to Supabase
 */
router.post('/api/publish/:recordId', async (req, res) => {
  try {
    const { recordId } = req.params;
    const { sectionId, secretKey } = req.body;
    
    // Basic security check - validate a shared secret
    if (secretKey !== process.env.AIRTABLE_WEBHOOK_SECRET) {
      return res.status(401).json({ 
        success: false, 
        error: 'Unauthorized' 
      });
    }
    
    if (!sectionId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Section ID is required' 
      });
    }
    
    // 1. Get the article from Airtable
    console.log(`Fetching Airtable record: ${recordId} from section: ${sectionId}`);
    const airtableRecord = await airtableService.getRecord(recordId, sectionId);
    
    if (!airtableRecord) {
      return res.status(404).json({ 
        success: false, 
        error: `Article with ID ${recordId} not found` 
      });
    }
    
    console.log(`Retrieved Airtable record: ${airtableRecord.id}`);
    console.log(`Article title: ${airtableRecord.fields?.title || 'Untitled'}`);
    console.log(`Article has content: ${!!airtableRecord.fields?.article}`);
    
    // Print out the fields to help with debugging
    console.log('Airtable Record Fields:', JSON.stringify(airtableRecord.fields, null, 2));
    
    // Validate required fields
    if (!airtableRecord.fields?.title) {
      return res.status(400).json({
        success: false,
        error: 'Record is missing required field: title'
      });
    }
    
    // 2. Publish to Supabase
    console.log('Attempting to publish to Supabase...');
    const result = await supabaseService.publishArticle(airtableRecord, sectionId);
    
    console.log('Publish result:', JSON.stringify(result, null, 2));
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Unknown error publishing to Supabase'
      });
    }
    
    // Update Airtable record status to indicate it's been sent to Supabase
    try {
      await airtableService.updateRecord(recordId, {
        "Estado": "En Supabase", // or "Publicado" if that's what you're using
        "Fecha Publicación": new Date().toISOString()
      }, sectionId);
      console.log('Updated Airtable record status');
    } catch (updateError) {
      console.warn('Warning: Could not update Airtable status', updateError.message);
      // Continue anyway - this is not critical
    }
    
    // 3. Return success response
    return res.status(200).json({
      success: true,
      message: `Article "${airtableRecord.fields?.title || 'Untitled'}" published successfully`,
      data: result.data
    });
    
  } catch (error) {
    const errorId = logError('publish-endpoint', error, { 
      recordId: req.params.recordId,
      sectionId: req.body.sectionId
    });
    
    console.error(`[${errorId}] Error publishing article: ${error.message}`);
    
    return res.status(500).json({
      success: false,
      error: `Error publishing article: ${error.message}`,
      errorId
    });
  }
});

module.exports = router;