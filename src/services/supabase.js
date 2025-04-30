import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';
import slugify from 'slugify'; // Make sure to import this at the top

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

// Add this helper function to generate a slug
function generateSlug(title) {
  if (!title) return '';
  return slugify(title, {
    lower: true,      // convert to lower case
    strict: true,     // strip special characters
    trim: true        // trim leading and trailing spaces
  });
}

// Add this section mapping at the top level of the file
const sectionNameToId = {
  'Coronel Suárez': 'coronel-suarez',
  'Pueblos Alemanes': 'pueblos-alemanes',
  'Huanguelén': 'huanguelen',
  'La Sexta': 'la-sexta',
  'Política': 'politica',
  'Economía': 'economia',
  'Agro': 'agro',
  'Sociedad': 'sociedad',
  'Salud': 'salud',
  'Cultura': 'cultura',
  'Opinión': 'opinion',
  'Deportes': 'deportes',
  'Lifestyle': 'lifestyle',
  'Vinos': 'vinos',
  'El Recetario': 'el-recetario',
  'Santa Trinidad': 'santa-trinidad',
  'San José': 'san-jose',
  'Santa María': 'santa-maria',
  'IActualidad': 'iactualidad',
  'Dólar': 'dolar',
  'Propiedades': 'propiedades',
  'Pymes y Emprendimientos': 'pymes-emprendimientos',
  'Inmuebles': 'inmuebles',
  'Campos': 'campos',
  'Construcción y Diseño': 'construccion-diseno',
  'Agricultura': 'agricultura',
  'Ganadería': 'ganaderia',
  'Tecnologías': 'tecnologias-agro',
  'Educación': 'educacion',
  'Policiales': 'policiales',
  'Efemérides': 'efemerides',
  'Ciencia': 'ciencia',
  'Vida en Armonía': 'vida-armonia',
  'Nutrición y energía': 'nutricion-energia',
  'Fitness': 'fitness',
  'Salud mental': 'salud-mental',
  'Turismo': 'turismo',
  'Horóscopo': 'horoscopo',
  'Feriados': 'feriados',
  'Loterías y Quinielas': 'loterias-quinielas',
  'Moda y Belleza': 'moda-belleza',
  'Mascotas': 'mascotas'
};

/**
 * Creates article in Supabase from Airtable record
 */
async function publishArticle(airtableRecord) {
  try {
    logger.info('Publishing article to Supabase:', airtableRecord.id);
    
    // Extract section from Airtable record
    const airtableSection = airtableRecord.fields.section || '';
    logger.info(`Original Airtable section: "${airtableSection}"`);
    
    // Map the Airtable section name to a Supabase section ID
    let sectionId = '';
    if (airtableSection) {
      // Look up the section ID from the mapping
      sectionId = sectionNameToId[airtableSection];
      
      if (sectionId) {
        logger.info(`Mapped section "${airtableSection}" to ID "${sectionId}"`);
      } else {
        // If not found in mapping, try to normalize it
        sectionId = airtableSection.toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // Remove accents
          .replace(/[^a-z0-9]+/g, '-'); // Replace non-alphanumeric with hyphens
        logger.info(`No direct mapping found, normalized to: "${sectionId}"`);
      }
    }
    
    // If we still don't have a valid section ID, use a default
    if (!sectionId) {
      sectionId = 'primera-plana';
      logger.info(`No valid section found, defaulting to: "${sectionId}"`);
    }
    
    // Generate a slug from title or use URL if available
    let slug = '';
    if (airtableRecord.fields.url) {
      // Extract slug from URL if available
      const urlParts = airtableRecord.fields.url.split('/');
      slug = urlParts[urlParts.length - 1];
    } else if (airtableRecord.fields.title) {
      // Generate slug from title
      slug = generateSlug(airtableRecord.fields.title);
    }
    
    // Ensure slug is not empty (add timestamp if needed)
    if (!slug) {
      slug = `article-${Date.now()}`;
    }
    
    logger.info(`Generated slug: "${slug}"`);

    // Map all Airtable fields to Supabase schema
    const articleData = {
      airtable_id: airtableRecord.id, // Use underscore, not hyphen
      title: airtableRecord.fields.title || '',
      slug: slug, // Add the generated slug here
      overline: airtableRecord.fields.overline || airtableRecord.fields.volanta || '',
      excerpt: airtableRecord.fields.excerpt || airtableRecord.fields.bajada || '',
      article: airtableRecord.fields.article || '',
      url: airtableRecord.fields.url || '',
      source: airtableRecord.fields.source || '',
      image: airtableRecord.fields.imagen || airtableRecord.fields.image ? 
             JSON.stringify(airtableRecord.fields.imagen || airtableRecord.fields.image) : null,
      imgUrl: airtableRecord.fields.imgUrl || '',
      "article-images": airtableRecord.fields['article-images'] || '',
      "ig-post": airtableRecord.fields['ig-post'] || '',
      "fb-post": airtableRecord.fields['fb-post'] || '',
      "tw-post": airtableRecord.fields['tw-post'] || '',
      "yt-video": airtableRecord.fields['yt-video'] || '',
      status: airtableRecord.fields.status || 'draft',
      
      // Use the mapped section ID
      section: sectionId,
      
      // Also store the original section name in a metadata field if you want
      section_name: airtableSection
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

    // Before the upsert, log what we're trying to do
    logger.debug(`Attempting to upsert article with airtable_id: ${airtableRecord.id}`);
    
    // Insert or update in Supabase - change the approach for better debugging
    let result;
    
    try {
      // First try regular upsert
      result = await supabase
        .from('articles')
        .upsert(articleData, {
          onConflict: 'airtable_id',
          returning: 'minimal' // Try with minimal first
        });
        
      if (result.error) throw result.error;
      
      // If upsert succeeded but no data returned, do a separate select to get the data
      if (!result.data || result.data.length === 0) {
        logger.info('Upsert succeeded but no data returned, fetching article data separately');
        
        // Get the article we just upserted
        const selectResult = await supabase
          .from('articles')
          .select('*')
          .eq('airtable_id', airtableRecord.id)
          .single();
          
        if (selectResult.error) throw selectResult.error;
        if (!selectResult.data) throw new Error('Could not find the article after upsert');
        
        // Use this data instead
        result.data = [selectResult.data];
      }
    } catch (dbError) {
      logger.error('Database operation failed:', dbError);
      throw dbError;
    }
    
    // Check if we have data after all operations
    if (!result.data || result.data.length === 0) {
      logger.error('Still no data after attempted recovery');
      
      // Create a recovery response with basic info
      return {
        success: true, // Return success anyway to not disrupt the flow
        data: {
          message: 'Article was saved but database did not return details',
          title: articleData.title,
          slug: articleData.slug,
          airtable_id: airtableRecord.id,
          section: articleData.section
        }
      };
    }

    logger.info('Successfully published to Supabase');
    
    // Return response with the data we have
    return {
      success: true,
      data: {
        id: result.data[0].id || 'unknown',
        title: articleData.title,
        slug: articleData.slug,
        section: sectionId,
        section_name: airtableSection,
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