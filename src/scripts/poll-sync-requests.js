import dotenv from 'dotenv';
import Airtable from 'airtable';
import { createClient } from '@supabase/supabase-js';
import slugify from 'slugify';

// Load environment variables
dotenv.config();

// Initialize Airtable
const airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_TOKEN });
const base = airtable.base(process.env.AIRTABLE_BASE_ID);

// Initialize Supabase - using the same env variables as in src/routes/publish.js
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Create a slug from a title
 */
function createSlug(title) {
  if (!title) return 'untitled'
  return slugify(title, {
    lower: true,
    strict: true,
    remove: /[*+~.()'"!:@]/g
  })
}

/**
 * Map section value to section_id
 */
function mapSectionToId(sectionValue) {
  const sectionMapping = {
    'Politica': 'primera-plana',
    'Economia': 'economia',
    'Agro': 'agro',
    // Add more mappings as needed for future sections
  }
  
  return sectionMapping[sectionValue] || 'primera-plana'
}

/**
 * Extract source name from URL dynamically
 */
function extractSourceName(url) {
  try {
    if (!url) return '';
    
    // Parse the URL to get the hostname
    const hostname = new URL(url).hostname;
    
    // Remove common prefixes and get domain
    let domain = hostname
      .replace(/^www\./, '')
      .replace(/^m\./, '');
    
    // Handle social media and known sources
    const sourceMappings = {
      'infobae.com': 'Infobae',
      'clarin.com': 'Clarín',
      'lanacion.com.ar': 'La Nación',
      'pagina12.com.ar': 'Página 12',
      'ambito.com': 'Ámbito Financiero',
      'perfil.com': 'Perfil',
      'cronista.com': 'El Cronista',
      'telam.com.ar': 'Télam',
      'tn.com.ar': 'Todo Noticias',
      'losandes.com.ar': 'Los Andes'
    };
    
    // Check for exact domain match
    if (sourceMappings[domain]) {
      return sourceMappings[domain];
    }
    
    // Extract main domain name without TLDs
    domain = domain.replace(/\.(com|co|net|org|ar|mx|es|cl|pe|br|uy|py|bo)(\.[a-z]{2})?$/, '');
    
    // Format source name (capitalize first letter of each word)
    return domain
      .split(/[-_\.]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
      
  } catch (error) {
    console.error(`Error extracting source name:`, error);
    return '';
  }
}

/**
 * Helper function to safely get field values
 */
function getField(fields, name, defaultValue = '') {
  // Direct match for expected field name
  if (fields[name] !== undefined && fields[name] !== null && fields[name] !== '') {
    return fields[name];
  }
  
  // Try capitalized version
  const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
  if (fields[capitalized] !== undefined && fields[capitalized] !== null && fields[capitalized] !== '') {
    return fields[capitalized];
  }
  
  // Handle special cases for image URL
  if (name === 'imgUrl') {
    if (fields['image'] !== undefined && fields['image'] !== null && fields['image'] !== '') {
      return fields['image'];
    }
  }
  
  return defaultValue;
}

/**
 * Process a single record and sync it to Supabase
 */
async function processRecord(record, tableName) {
  console.log(`Processing record ${record.id} from ${tableName}`);
  
  try {
    const fields = record.fields;
    
    // Get section value and map to section_id
    const sectionValue = getField(fields, 'section', 'Politica');
    const sectionId = mapSectionToId(sectionValue);

    // Create slug from title
    const title = getField(fields, 'title', 'Untitled');
    const slug = createSlug(title);

    // Get source name
    const sourceValue = getField(fields, 'source', '');
    const urlValue = getField(fields, 'url', '');
    let sourceName = sourceValue;

    if (!sourceName && urlValue) {
      sourceName = extractSourceName(urlValue);
    }

    // Handle article images
    let articleImages = [];
    const articleImagesField = getField(fields, 'article-images', '');
    if (articleImagesField) {
      if (typeof articleImagesField === 'string') {
        articleImages = articleImagesField
          .split(',')
          .map(url => url.trim())
          .filter(url => url.length > 0);
      } else if (Array.isArray(articleImagesField)) {
        articleImages = articleImagesField;
      }
    }

    // Prepare social media as JSON
    const socialMedia = {
      instagram: getField(fields, 'ig-post', ''),
      facebook: getField(fields, 'fb-post', ''),
      twitter: getField(fields, 'tw-post', ''),
      youtube: getField(fields, 'yt-video', '')
    };

    // Prepare article data for Supabase with exact field mappings
    const articleData = {
      airtable_id: record.id,
      title: title,
      slug: slug,
      content: getField(fields, 'article', ''),
      excerpt: getField(fields, 'excerpt', ''),
      overline: getField(fields, 'overline', ''),
      image_url: getField(fields, 'imgUrl', getField(fields, 'image', '')),
      article_images: articleImages,
      url: urlValue,
      source: sourceName,
      source_url: urlValue,
      instagram_post: getField(fields, 'ig-post', ''),
      facebook_post: getField(fields, 'fb-post', ''),
      twitter_post: getField(fields, 'tw-post', ''),
      youtube_video: getField(fields, 'yt-video', ''),
      social_media: socialMedia,
      section_id: sectionId,
      section_name: sectionValue,
      status: 'draft',  // Set default status in Supabase
      updated_at: new Date().toISOString()
    };

    console.log(`Prepared article data for ${title}`);
    
    // Check if record already exists in Supabase
    const { data: existingRecords } = await supabase
      .from('articles')
      .select('id')
      .eq('airtable_id', record.id);
    
    let result;
    let operation;
    
    if (existingRecords && existingRecords.length > 0) {
      // Update existing record
      result = await supabase
        .from('articles')
        .update(articleData)
        .eq('airtable_id', record.id)
        .select();
      
      operation = 'updated';
      console.log(`Updated existing record in Supabase: ${title}`);
    } else {
      // Insert new record
      result = await supabase
        .from('articles')
        .insert(articleData)
        .select();
      
      operation = 'created';
      console.log(`Created new record in Supabase: ${title}`);
    }
    
    if (result.error) {
      throw new Error(`Supabase error: ${result.error.message}`);
    }
    
    // Update the record in Airtable to mark it as synced
    await base(tableName).update(record.id, {
      status: {name: 'synced'}  // Correct format for Single Select fields
    });
    
    return {
      success: true,
      operation: operation,
      id: result.data[0].id,
      title: title
    };
    
  } catch (error) {
    console.error(`Error processing record ${record.id}:`, error);
    
    // Update the record in Airtable to mark the error
    try {
      await base(tableName).update(record.id, {
        status: {name: 'error'}  // Correct format for Single Select fields
      });
    } catch (updateError) {
      console.error(`Failed to update error status in Airtable:`, updateError);
    }
    
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Poll for records that have publication status
 */
async function pollSyncRequests() {
  try {
    console.log('Polling for sync requests...');
    
    // Get all tables in the base
    const tablesList = await base.tables;
    
    let totalProcessed = 0;
    
    // Process each table
    for (const table of tablesList) {
      console.log(`Checking table: ${table.name}`);
      
      // Find records with status values indicating they should be published
      // Try multiple possible status values
      const records = await base(table.name)
        .select({
          filterByFormula: "OR({status} = 'publish', {status} = 'published', {status} = 'Publicado', {status} = 'ready', {status} = 'Ready')"
        })
        .all();
        
      console.log(`Found ${records.length} records to sync in ${table.name}`);
      
      // Process each record
      for (const record of records) {
        await processRecord(record, table.name);
        totalProcessed++;
      }
    }
    
    console.log(`Polling complete. Processed ${totalProcessed} records.`);
    
  } catch (error) {
    console.error('Error polling for sync requests:', error);
  }
}

// Run once on script execution
console.log('Starting sync request polling...');
pollSyncRequests().then(() => {
  console.log('Initial poll complete');
});

// Set up periodic polling (every 1 minute)
setInterval(pollSyncRequests, 60000);