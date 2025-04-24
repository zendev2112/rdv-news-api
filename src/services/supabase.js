import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

// Initialize dotenv
dotenv.config();

// Create a single supabase client for interacting with your database
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Decode JWT to log role type
// Decode JWT to log role type
function decodeJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(Buffer.from(base64, 'base64').toString().split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    console.error('Error decoding JWT:', e);
    return { error: 'Invalid token format' };
  }
}

const decodedKey = decodeJwt(supabaseKey);
console.log('Supabase key role:', decodedKey.role || 'unknown');
if (decodedKey.role !== 'service_role') {
  console.warn('WARNING: Not using a service_role key. This may cause RLS policy violations.');
}

/**
 * Creates article in Supabase from Airtable record
 */
async function publishArticle(airtableRecord) {
  try {
    logger.info('Publishing article to Supabase:', airtableRecord.id);

    // Dynamic section handling - multiple fallbacks to get the right section_id
    let section_id = null;
    let section = '';

    // Option 1: Use the section field from Airtable if available
    if (airtableRecord.fields.section) {
      section = airtableRecord.fields.section;
      // Convert to kebab-case for section_id 
      section_id = section.toLowerCase().replace(/\s+/g, '-');
    }

    // Option 2: Use the sourceSectionId (table name) if passed from the webhook
    if (!section_id && airtableRecord.sourceSectionId) {
      section_id = airtableRecord.sourceSectionId.toLowerCase().replace(/\s+/g, '-');
      // Also use it for section if section is empty
      if (!section) {
        // Convert kebab-case to Title Case for display
        section = airtableRecord.sourceSectionId
          .split(/[-_]/)
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');
      }
    }

    // Map all Airtable fields to Supabase schema
    const articleData = {
      id: airtableRecord.id,
      title: airtableRecord.fields.title || '',
      overline: airtableRecord.fields.overline || '',
      excerpt: airtableRecord.fields.excerpt || '',
      article: airtableRecord.fields.article || '',
      url: airtableRecord.fields.url || '',
      source: airtableRecord.fields.source || '',
      image: airtableRecord.fields.image ? JSON.stringify(airtableRecord.fields.image) : null,
      img_url: airtableRecord.fields.imgUrl || '',
      article_images: airtableRecord.fields['article-images'] || '',
      ig_post: airtableRecord.fields['ig-post'] || '',
      fb_post: airtableRecord.fields['fb-post'] || '',
      tw_post: airtableRecord.fields['tw-post'] || '',
      yt_video: airtableRecord.fields['yt-video'] || '',
      status: airtableRecord.fields.status || 'draft',
      section: section,
      section_id: section_id,
    };

    logger.info('Prepared article data for Supabase');
    logger.debug('Article data fields:', Object.keys(articleData));

    // Insert or update in Supabase
    const { data, error } = await supabase
      .from('articles')
      .upsert(articleData, {
        onConflict: 'id',
        returning: 'representation',
      });

    if (error) {
      logger.error('Supabase error:', error);
      throw error;
    }

    // If no data is returned, use our article data
    if (!data || data.length === 0) {
      logger.warn('No data returned from Supabase upsert, using input data');
      return {
        success: true,
        data: {
          id: articleData.id,
          title: articleData.title,
          section: articleData.section,
          section_id: articleData.section_id,
          status: articleData.status,
        },
      };
    }

    logger.info('Successfully published to Supabase with ID:', data[0].id);

    return {
      success: true,
      data: {
        id: data[0].id,
        title: data[0].title,
        section: data[0].section,
        section_id: data[0].section_id,
        status: data[0].status,
      },
    };
  } catch (error) {
    logger.error('Error in publishArticle:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
/**
 * Gets all published articles
 */
async function getArticles({ limit = 50, offset = 0, section = null } = {}) {
  try {
    let query = supabase
      .from('articles')
      .select('*')
      .eq('status', 'published')
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (section) {
      query = query.eq('section', section);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    return {
      success: true,
      data
    };
  } catch (error) {
    console.error('Error fetching articles from Supabase:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Gets a single article by ID
 */
async function getArticleById(id) {
  try {
    const { data, error } = await supabase
      .from('articles')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    
    return {
      success: true,
      data
    };
  } catch (error) {
    console.error(`Error fetching article with ID ${id} from Supabase:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Create a default export for the service
const supabaseService = {
  supabase,
  publishArticle,
  getArticles,
  getArticleById
};

export default supabaseService;