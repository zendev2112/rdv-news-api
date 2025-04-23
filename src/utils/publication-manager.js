import { createClient } from '@supabase/supabase-js';
import Airtable from 'airtable';
import dotenv from 'dotenv';

dotenv.config();

// Initialize clients
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const airtableBase = new Airtable({ apiKey: process.env.AIRTABLE_TOKEN }).base(process.env.AIRTABLE_BASE_ID);

/**
 * Updates an article's publication status
 * @param {string} recordId - Airtable record ID
 * @param {string} table - Airtable table name
 * @param {boolean} publish - True to publish, false for draft
 * @returns {Promise<Object>} Result object
 */
export async function updatePublicationStatus(recordId, table = 'Primera Plana', publish = true) {
  try {
    console.log(`${publish ? 'Publishing' : 'Setting to draft'}: ${recordId}`);
    
    // 1. Update status in Airtable
    const newStatus = publish ? 'Publicado' : 'Borrador';
    
    await airtableBase(table).update(recordId, {
      status: newStatus
    });
    
    console.log(`Airtable status updated to: ${newStatus}`);
    
    // 2. Get the updated record with all fields
    const record = await airtableBase(table).find(recordId);
    
    if (!record) {
      throw new Error('Failed to fetch updated record');
    }
    
    // 3. Prepare article data for Supabase
    const fields = record.fields;
    const publishedAt = publish ? new Date().toISOString() : null;
    
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
      status: publish ? 'published' : 'draft',
      published_at: publishedAt,
      airtable_id: record.id,
      updated_at: new Date().toISOString()
    };
    
    // 4. Update or insert in Supabase
    const { data: existingArticle } = await supabase
      .from('articles')
      .select('id')
      .eq('airtable_id', record.id)
      .maybeSingle();
    
    let result;
    if (existingArticle) {
      // Update existing record
      result = await supabase
        .from('articles')
        .update(articleData)
        .eq('id', existingArticle.id)
        .select();
    } else {
      // Insert new record
      result = await supabase
        .from('articles')
        .insert(articleData)
        .select();
    }
    
    if (result.error) {
      throw new Error(`Supabase error: ${result.error.message}`);
    }
    
    return {
      success: true,
      operation: existingArticle ? 'update' : 'insert',
      status: articleData.status,
      id: result.data[0].id,
      article: {
        title: articleData.title,
        status: articleData.status,
        published_at: articleData.published_at
      }
    };
  } catch (error) {
    console.error(`Publication status update error:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

export default {
  updatePublicationStatus
};