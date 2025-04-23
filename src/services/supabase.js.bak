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
    console.log('Publishing article to Supabase:', airtableRecord.id)

    // Debug logging to see all available fields
    console.log('Airtable record fields:', Object.keys(airtableRecord.fields))

    // Extract image URL from Airtable - handling all possible formats
    let imageUrl = ''

    // Handle Airtable attachment format for imgUrl field
    if (airtableRecord.fields.imgUrl) {
      const imgUrlField = airtableRecord.fields.imgUrl

      if (typeof imgUrlField === 'string') {
        // If it's already a string URL
        imageUrl = imgUrlField
        console.log('Found imgUrl as string:', imageUrl)
      } else if (Array.isArray(imgUrlField)) {
        // If it's an array of attachments (common Airtable format)
        console.log('imgUrl is an array with length:', imgUrlField.length)

        if (imgUrlField.length > 0) {
          // Check if it's an array of attachment objects
          if (imgUrlField[0] && imgUrlField[0].url) {
            imageUrl = imgUrlField[0].url
            console.log('Found image URL in attachment object:', imageUrl)
          } else {
            // It might be an array of URLs
            imageUrl = imgUrlField[0]
            console.log('Using first array item as URL:', imageUrl)
          }
        }
      } else if (typeof imgUrlField === 'object' && imgUrlField !== null) {
        // If it's a single attachment object
        console.log(
          'imgUrl is an object:',
          JSON.stringify(imgUrlField).substring(0, 200)
        )

        if (imgUrlField.url) {
          imageUrl = imgUrlField.url
          console.log('Found URL in attachment object:', imageUrl)
        } else if (imgUrlField.thumbnails && imgUrlField.thumbnails.large) {
          imageUrl = imgUrlField.thumbnails.large.url
          console.log('Found URL in thumbnails:', imageUrl)
        }
      }
    }

    // Prepare social media data as a structured object
    const socialMedia = {
      instagram: airtableRecord.fields['ig-post'] || null,
      facebook: airtableRecord.fields['fb-post'] || null,
      twitter: airtableRecord.fields['tw-post'] || null,
      youtube: airtableRecord.fields['yt-video'] || null,
    }

    // Map all Airtable fields to Supabase schema
    const articleData = {
      title: airtableRecord.fields.title || '',
      content: airtableRecord.fields.article || '',
      excerpt: airtableRecord.fields.bajada || '',
      overline: airtableRecord.fields.volanta || '',
      section_id: sectionId || airtableRecord.fields.section || '',
      section_name: getSectionName(
        sectionId || airtableRecord.fields.section || ''
      ),
      slug:
        airtableRecord.fields.slug ||
        generateSlug(airtableRecord.fields.title || ''),
      image_url: imageUrl,
      source_url: airtableRecord.fields.url || '',
      social_media: JSON.stringify(socialMedia),
      author: airtableRecord.fields.author || airtableRecord.fields.autor || '',
      airtable_id: airtableRecord.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    // Map estado field to status and set published_at if estado is "Publicado"
    if (airtableRecord.fields.estado === 'Publicado') {
      articleData.status = 'published' // Use 'published' in Supabase
      articleData.published_at = new Date().toISOString()
      console.log(
        'Article marked as PUBLISHED with timestamp:',
        articleData.published_at
      )
    } else {
      articleData.status = 'draft' // Use 'draft' in Supabase for "Borrador"
      articleData.published_at = null // Ensure published_at is null for drafts
      console.log('Article saved as DRAFT (not published)')
    }

    console.log('Prepared article data for Supabase with fields:')
    console.log('- title:', articleData.title ? 'Present' : 'Missing')
    console.log('- image_url:', articleData.image_url ? 'Present' : 'Missing')
    console.log('- section_id:', articleData.section_id)
    console.log('- status:', articleData.status)
    console.log(
      '- social media fields:',
      Object.keys(socialMedia)
        .filter((k) => socialMedia[k] !== null)
        .join(', ')
    )

    // Insert or update in Supabase
    const { data, error } = await supabase
      .from('articles')
      .upsert(articleData, {
        onConflict: 'airtable_id',
        returning: 'representation',
      })

    if (error) {
      console.error('Supabase error:', error)
      throw error
    }

    console.log('Successfully published to Supabase with ID:', data[0].id)

    return {
      success: true,
      data: {
        id: data[0].id,
        title: data[0].title,
        slug: data[0].slug,
        published: data[0].published,
      },
    }
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

// Helper function to get section name from section ID
function getSectionName(sectionId) {
  const sectionMap = {
    'primera-plana': 'Primera Plana',
    'politica': 'Política',
    'economia': 'Economía',
    'deportes': 'Deportes',
    'cultura': 'Cultura',
    'opinion': 'Opinión',
    'agro': 'Agro',
    'actualidad': 'Actualidad',
    'ciencia': 'Ciencia y Salud',
    'lifestyle': 'Estilo de Vida',
    'tecnologia': 'Tecnología',
    'entretenimiento': 'Entretenimiento'
  };
  return sectionMap[sectionId] || sectionId;
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