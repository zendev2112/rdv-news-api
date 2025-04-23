import express from 'express';
import { updatePublicationStatus } from '../utils/publication-manager.js';

const router = express.Router();

/**
 * Endpoint to publish or unpublish an article
 * POST /admin/article/publish
 */
router.post('/article/publish', async (req, res) => {
  try {
    const { recordId, publish = true, table = 'Primera Plana' } = req.body;
    
    if (!recordId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: recordId'
      });
    }
    
    const result = await updatePublicationStatus(recordId, table, publish);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
    
    return res.json({
      success: true,
      message: `Article successfully ${publish ? 'published' : 'set to draft'}`,
      data: result.article
    });
    
  } catch (error) {
    console.error('Error in admin endpoint:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;