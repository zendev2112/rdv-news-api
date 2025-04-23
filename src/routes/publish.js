import express from 'express';
import Airtable from 'airtable';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Airtable
const airtableBase = new Airtable({
  apiKey: process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY
}).base(process.env.AIRTABLE_BASE_ID);

// Check if Supabase environment variables are available
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

// Validate Supabase configuration
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase configuration. Please check your environment variables:');
  console.error('- SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL must be set');
  console.error('- SUPABASE_KEY or SUPABASE_SERVICE_ROLE_KEY must be set');
  // We'll continue anyway, but Supabase operations will fail
}

// Initialize Supabase with safety checks
const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey)
  : null;

const router = express.Router();

/**
 * Endpoint to handle Airtable publish button events
 * Expects: { recordId, tableName }
 */
router.post('/publish', async (req, res) => {
  try {
    // Check if Supabase is properly configured
    if (!supabase) {
      return res.status(500).json({
        success: false,
        error: 'Supabase is not properly configured. Check server logs for details.'
      });
    }
    
    const { recordId, tableName } = req.body;
    
    if (!recordId || !tableName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: recordId or tableName'
      });
    }
    
    console.log(`Publishing record ${recordId} from ${tableName}`);
    
    // Fetch the record from Airtable
    let record;
    try {
      record = await airtableBase(tableName).find(recordId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        error: `Record not found: ${error.message}`
      });
    }
    
    // Process the record based on its current status
    const fields = record.fields;
    const isPublished = fields.status === 'Publicado';
    const publishedAt = isPublished ? new Date().toISOString() : null;
    
    // Prepare article data
    const articleData = {
      title: fields.title || 'Untitled',
      overline: fields.overline || '',
      excerpt: fields.excerpt || '',
      article: fields.article || '',
      url: fields.url || '',
      imgUrl: fields.imgUrl || '',
      article_images: fields['article-images'] || [],
      instagram_post: fields['ig-post'] || null,
      facebook_post: fields['fb-post'] || null,
      twitter_post: fields['tw-post'] || null,
      youtube_video: fields['yt-video'] || null,
      section: fields.section || 'primera-plana',
      status: isPublished ? 'published' : 'draft',
      published_at: publishedAt,
      airtable_id: record.id,
      updated_at: new Date().toISOString()
    };
    
    // Check if article already exists in Supabase
    const { data: existingArticle } = await supabase
      .from('articles')
      .select('id')
      .eq('airtable_id', record.id)
      .maybeSingle();
      
    let result;
    if (existingArticle) {
      // Update existing article
      result = await supabase
        .from('articles')
        .update(articleData)
        .eq('id', existingArticle.id)
        .select();
    } else {
      // Insert new article
      result = await supabase
        .from('articles')
        .insert(articleData)
        .select();
    }
    
    if (result.error) {
      return res.status(500).json({
        success: false,
        error: `Supabase error: ${result.error.message}`
      });
    }
    
    // Send success response
    res.json({
      success: true,
      message: `Article successfully ${isPublished ? 'published' : 'saved as draft'}`,
      data: {
        id: result.data[0].id,
        status: articleData.status,
        title: articleData.title
      }
    });
    
  } catch (error) {
    console.error('Error in publish endpoint:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;