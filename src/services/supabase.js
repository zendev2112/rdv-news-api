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

// Updated helper function to generate a higher quality slug
function generateSlug(title) {
  if (!title || typeof title !== 'string') {
    logger.warn('Invalid title for slug generation');
    return `article-${Date.now()}`;
  }
  
  // Step 1: Normalize the text to remove accents
  const normalized = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  
  // Step 2: Create a better quality slug
  let slug = slugify(normalized, {
    lower: true,       // convert to lower case
    strict: true,      // strip special characters
    trim: true,        // trim leading and trailing spaces
    replacement: '-',  // replace spaces with hyphens
    locale: 'es',      // Use Spanish locale for better handling of special chars
    remove: /[*+~.()'"!:@#%^&]/g // Remove more problematic characters
  });
  
  // Step 3: Clean up the result
  slug = slug
    .replace(/-+/g, '-')     // Replace multiple dashes with single dash
    .replace(/^-+|-+$/g, ''); // Remove leading and trailing dashes
  
  // Step 4: Limit slug length but preserve whole words where possible
  if (slug.length > 80) {
    // Cut at the last dash before character 80
    const lastDashPos = slug.substring(0, 80).lastIndexOf('-');
    if (lastDashPos > 40) { // Ensure we don't cut too short
      slug = slug.substring(0, lastDashPos);
    } else {
      // If no suitable dash found, just cut at 80
      slug = slug.substring(0, 80);
    }
  }
  
  // Step 5: Ensure we have something valid
  if (!slug) {
    return `article-${Date.now()}`;
  }
  
  logger.info(`Generated high-quality slug from "${title}": "${slug}"`);
  return slug;
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
      overline:
        airtableRecord.fields.overline || airtableRecord.fields.volanta || '',
      excerpt:
        airtableRecord.fields.excerpt || airtableRecord.fields.bajada || '',
      article: airtableRecord.fields.article || '',
      url: airtableRecord.fields.url || '',
      source: airtableRecord.fields.source || '',
      image:
        airtableRecord.fields.imagen || airtableRecord.fields.image
          ? JSON.stringify(
              airtableRecord.fields.imagen || airtableRecord.fields.image
            )
          : null,
      imgUrl: airtableRecord.fields.imgUrl || '',
      'article-images': airtableRecord.fields['article-images'] || '',
      'ig-post': airtableRecord.fields['ig-post'] || '',
      'fb-post': airtableRecord.fields['fb-post'] || '',
      'tw-post': airtableRecord.fields['tw-post'] || '',
      'yt-video': airtableRecord.fields['yt-video'] || '',
      status: airtableRecord.fields.status || 'draft',

      // Add tags and social media text fields
      tags: airtableRecord.fields.tags || airtableRecord.tags || '',
      social_media_text:
        airtableRecord.fields.socialMediaText ||
        airtableRecord.socialMediaText ||
        '',
      front: airtableRecord.fields.front || null,
      order: airtableRecord.fields.order || null,

      // Use the mapped section ID
      section: sectionId,
    }
    
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

    // After successfully publishing to Supabase but before returning
    logger.info('Successfully published to Supabase');

    // Now create the relationship in the article_sections table
    try {
      // Get the article ID
      const articleId = result.data[0].id;
      
      // Create relationship in junction table
      logger.info(`Creating relationship between article ${articleId} and section ${sectionId}`);
      
      // First check if the relationship already exists
      const { data: existingRelation, error: checkError } = await supabase
        .from('article_sections')
        .select('*')
        .eq('article_id', articleId)
        .eq('section_id', sectionId)
        .maybeSingle();
      
      if (checkError && !checkError.message.includes('No rows found')) {
        logger.error('Error checking for existing article-section relationship:', checkError);
      } else if (!existingRelation) {
        // Determine if this should be the primary section
        // Check if this article has any sections already
        const { data: existingSections, error: sectionsError } = await supabase
          .from('article_sections')
          .select('*')
          .eq('article_id', articleId);
        
        const isPrimary = !sectionsError && (!existingSections || existingSections.length === 0);
        
        // Create the relationship
        const { error: relationError } = await supabase
          .from('article_sections')
          .insert({
            article_id: articleId,
            section_id: sectionId,
            is_primary: isPrimary
          });
        
        if (relationError) {
          logger.error('Error creating article-section relationship:', relationError);
        } else {
          logger.info(`Created article-section relationship successfully (primary: ${isPrimary})`);
        }
      } else {
        logger.info('Article-section relationship already exists, skipping creation');
      }
    } catch (relationError) {
      logger.error('Error managing article-section relationship:', relationError);
      // Continue with the return even if relationship creation fails
    }

    // Return response with the data
    return {
      success: true,
      data: {
        id: result.data[0].id || 'unknown',
        title: articleData.title,
        slug: articleData.slug,
        section: sectionId,
        section_name: airtableSection,
        status: articleData.status,
        tags: articleData.tags,
        social_media_text: articleData.social_media_text
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