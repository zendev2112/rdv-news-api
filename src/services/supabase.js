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

    // Special handling for Instituciones table
    if (airtableRecord.sourceSectionId === 'Instituciones' || 
        airtableRecord.isInstituciones === true) {
      logger.info('Special handling for Instituciones table');
      
      // For Instituciones table, force one of the valid section values
      // that matches exactly what's in the database constraint
      airtableRecord.forceSection = 'Politica';  // Use exactly what's in your DB constraint
      logger.info(`Forced section for Instituciones to "Politica"`);
    }

    // Ensure section value passes the check constraint 
    // Get section value from forceSection or from fields.section
    let sectionValue = airtableRecord.forceSection || airtableRecord.fields.section || '';
    
    // Log the original section
    logger.info(`Original section value: "${sectionValue}"`);
    
    // Valid sections in Supabase - these match your check constraint
    const validSections = ['primera-plana', 'politica', 'economia', 'agro', 'deportes', 'lifestyle', 'turismo'];
    
    // Normalize section value
    if (sectionValue) {
      sectionValue = sectionValue.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // Remove accents
        .replace(/[^a-z0-9]+/g, '-'); // Replace non-alphanumeric with hyphens
    }
    
    // Check if normalized section is valid, otherwise default to 'primera-plana'
    if (!validSections.includes(sectionValue)) {
      // Special case for Instituciones: use exact DB constraint value
      if (airtableRecord.sourceSectionId === 'Instituciones' || airtableRecord.isInstituciones === true) {
        logger.info(`For Instituciones table, using "Politica" (exact DB value)`);
        sectionValue = 'Politica'; // Exact match for DB constraint
      } else {
        logger.info(`Section "${sectionValue}" is not valid, defaulting to "primera-plana"`);
        sectionValue = 'primera-plana';
      }
    }
    
    logger.info(`Final section value: "${sectionValue}"`);

    // Map all Airtable fields to Supabase schema
    const articleData = {
      id: airtableRecord.id,
      title: airtableRecord.fields.title || '',
      overline: airtableRecord.fields.overline || airtableRecord.fields.volanta || '',
      excerpt: airtableRecord.fields.excerpt || airtableRecord.fields.bajada || '',
      article: airtableRecord.fields.article || '',
      url: airtableRecord.fields.url || '',
      source: airtableRecord.fields.source || '',
      image: airtableRecord.fields.imagen || airtableRecord.fields.image ? 
             JSON.stringify(airtableRecord.fields.imagen || airtableRecord.fields.image) : null,
      img_url: airtableRecord.fields.imgUrl || '',
      "article-images": airtableRecord.fields['article-images'] || '',
      "ig-post": airtableRecord.fields['ig-post'] || '',
      "fb-post": airtableRecord.fields['fb-post'] || '',
      "tw-post": airtableRecord.fields['tw-post'] || '',
      "yt-video": airtableRecord.fields['yt-video'] || '',
      status: airtableRecord.fields.status || 'draft',
      // Use the validated section value
      section: sectionValue,
      section_id: airtableRecord.forceSectionId || sectionValue
    };
    
    // Check for optional fields that might exist in some tables
    const optionalFields = ['section_name', 'section_color'];
    optionalFields.forEach(field => {
      if (airtableRecord.fields[field]) {
        articleData[field] = airtableRecord.fields[field];
      }
    });

    logger.info('Prepared article data for Supabase');
    logger.debug('Article data keys:', Object.keys(articleData));

    // Insert or update in Supabase
    const { data, error } = await supabase
      .from('articles')
      .upsert(articleData, {
        onConflict: 'id',
        returning: 'minimal', // Use 'representation' if you need the returned data
      });

    if (error) {
      logger.error('Supabase error:', error);
      throw error;
    }

    logger.info('Successfully published to Supabase with ID:', airtableRecord.id);

    return {
      success: true,
      data: {
        id: airtableRecord.id,
        title: articleData.title,
        section: articleData.section,
        section_id: articleData.section_id,
        status: articleData.status,
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