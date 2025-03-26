const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Create a single supabase client for interacting with your database
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

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
async function publishArticle(airtableRecord, sectionId) {
  try {
    console.log('Publishing article to Supabase:', airtableRecord.id);
    
    // Map Airtable fields to your Supabase schema
    const articleData = {
      title: airtableRecord.fields.title,
      content:
        airtableRecord.fields.article || airtableRecord.fields.content || '',
      excerpt:
        airtableRecord.fields.excerpt || airtableRecord.fields.bajada || '',
      section: sectionId,
      slug:
        airtableRecord.fields.slug || generateSlug(airtableRecord.fields.title),
      image_url:
        airtableRecord.fields.image_url || airtableRecord.fields.imagen || '',
      author: airtableRecord.fields.author || airtableRecord.fields.autor || '',
      airtable_id: airtableRecord.id,
      status: 'draft', // Default to unpublished/draft   // Use this instead of published:false
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    
    console.log('Prepared article data:', articleData);
    
    // Insert or update in Supabase
    const { data, error } = await supabase
      .from('articles') // Your table name in Supabase
      .upsert(articleData, { 
        onConflict: 'airtable_id', // Update if this Airtable ID already exists
        returning: 'representation' // Return the full record
      });
      
    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }
    
    console.log('Supabase response:', data);
    
    return {
      success: true,
      data: {
        id: data[0].id,
        title: data[0].title,
        slug: data[0].slug,
        published: data[0].published
      }
    };
    
  } catch (error) {
    console.error('Error in publishArticle:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Helper function to generate a slug from title
function generateSlug(title) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Remove consecutive hyphens
    .trim();
}

/**
 * Gets all published articles
 */
async function getArticles({ limit = 50, offset = 0, sectionId = null } = {}) {
  try {
    let query = supabase
      .from('articles')
      .select('*')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (sectionId) {
      query = query.eq('section_id', sectionId);
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
 * Gets a single article by slug
 */
async function getArticleBySlug(slug) {
  try {
    const { data, error } = await supabase
      .from('articles')
      .select('*')
      .eq('slug', slug)
      .single();
    
    if (error) throw error;
    
    return {
      success: true,
      data
    };
  } catch (error) {
    console.error(`Error fetching article with slug ${slug} from Supabase:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  supabase,
  publishArticle,
  getArticles,
  getArticleBySlug
};