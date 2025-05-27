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
      'article-images': fields['article-images'] || [],
      "ig-post": fields['ig-post'] || null,
      "fb-post": fields['fb-post'] || null,
      "tw-post": fields['tw-post'] || null,
      "yt-video": fields['yt-video'] || null,
      section: fields.section || 'primera-plana',
      status: isPublished ? 'published' : 'draft',
      published_at: publishedAt,
      airtable_id: record.id,
      updated_at: new Date().toISOString(),
    }
    
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

/**
 * Get articles for a specific front page section
 */
router.get('/front-section/:sectionName', async (req, res) => {
  try {
    const { sectionName } = req.params;
    
    if (!sectionName) {
      return res.status(400).json({ 
        success: false,
        error: 'Section name is required' 
      });
    }
    
    // Query for published articles that belong to the specified front section
    const { data, error } = await supabase
      .from('articles')
      .select('*')
      .eq('status', 'published')
      .eq('front', sectionName)
      .order('order', { ascending: true });
      
    if (error) {
      console.error('Error fetching front section articles:', error);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to fetch articles' 
      });
    }
    
    return res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error in front section endpoint:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Server error' 
    });
  }
});

export default router;