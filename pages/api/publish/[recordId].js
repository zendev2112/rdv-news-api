import { createClient } from '@supabase/supabase-js'
import Airtable from 'airtable'
import slugify from 'slugify'



// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Initialize Airtable
const airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })

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

// Add this helper function at the top of your file (after imports)
function getField(fields, name, defaultValue = '') {
  // Direct match for expected field name
  if (fields[name] !== undefined && fields[name] !== null && fields[name] !== '') {
    return fields[name];
  }
  
  // Handle special cases for image URL
  if (name === 'imgUrl') {
    if (fields['image'] !== undefined && fields['image'] !== null && fields['image'] !== '') {
      return fields['image'];
    }
  }
  
  return defaultValue;
}

// Handler for CORS preflight requests
export const config = {
  api: {
    bodyParser: true,
    externalResolver: true,
  },
};

// Wrap the entire handler function with a try/catch to prevent uncaught exceptions
export default async function handler(req, res) {
  try {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle OPTIONS request (preflight CORS check)
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    console.log('API endpoint called:', req.method, req.url);
    console.log('Query parameters:', req.query);
    if (req.body) console.log('Request body:', JSON.stringify(req.body, null, 2));

    // Update the GET request handler to show the updated usage
    if (req.method === 'GET') {
      // We need to handle GET requests properly now that we're using query parameters
      const { recordId } = req.query;
      const tableName = req.query.tableName;
      const secretKey = req.query.secretKey;
      
      console.log(`GET request received - RecordId: ${recordId}, TableName: ${tableName}`);
      
      // If we have all the required parameters, process the GET request as a publish request
      if (recordId && tableName && secretKey) {
        console.log(`Processing GET request for record ${recordId} from table ${tableName}`);
        
        // Verify secret key
        if (secretKey !== (process.env.PUBLISH_SECRET_KEY || '62f33d10f05777d89c0318e51409836475db969e40c203b273c139469ab39b65')) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        
        // Continue with processing this as a publish request
        // We'll reuse the same code path as POST requests
        req.body = { tableName, secretKey };
        // Let execution continue to the main processing code
      } else {
        console.log('Missing required parameters for GET request');
        // If we don't have all parameters, just show the API info
        return res.status(200).json({
          message: 'API endpoint is working',
          info: 'This endpoint publishes records from Airtable to Supabase',
          usage: {
            method: 'POST or GET',
            post_body: {
              tableName: 'Required: The name of your Airtable table',
              secretKey: 'Required: Your secret key for authentication'
            },
            get_query: {
              tableName: 'Required: The name of your Airtable table',
              secretKey: 'Required: Your secret key for authentication'
            },
            example: `GET /api/publish/RECORD_ID?tableName=YOUR_TABLE&secretKey=YOUR_SECRET_KEY`
          }
        });
      }
    }

    // Update the POST/GET validation to allow either method
    if (req.method !== 'POST' && req.method !== 'GET') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Use secret key from environment variable with fallback
    const SECRET_KEY = process.env.PUBLISH_SECRET_KEY || '62f33d10f05777d89c0318e51409836475db969e40c203b273c139469ab39b65';

    // Get secretKey from either body or query parameters
    const secretKey = (req.body && req.body.secretKey) || req.query.secretKey;
    
    console.log('Secret key check:', !!secretKey);
    
    // Verify secret key
    if (secretKey !== SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check environment variables
    console.log('Checking environment variables');
    console.log('NEXT_PUBLIC_SUPABASE_URL:', !!process.env.NEXT_PUBLIC_SUPABASE_URL);
    console.log('SUPABASE_SERVICE_ROLE_KEY:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
    console.log('AIRTABLE_API_KEY:', !!process.env.AIRTABLE_API_KEY);
    console.log('AIRTABLE_BASE_ID:', !!process.env.AIRTABLE_BASE_ID);

    // Ensure we have the required environment variables
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Missing required environment variables for Supabase');
      return res.status(500).json({
        error: 'Server Configuration Error',
        message: 'Missing Supabase environment variables'
      });
    }

    if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
      console.error('Missing required environment variables for Airtable');
      return res.status(500).json({
        error: 'Server Configuration Error',
        message: 'Missing Airtable environment variables'
      });
    }
    
    try {
      const { recordId } = req.query;
      
      // Get tableName from either body or query parameters
      const tableName = (req.body && req.body.tableName) || req.query.tableName;
      
      console.log(`Processing with recordId=${recordId}, tableName=${tableName}`);
      
      if (!tableName) {
        return res.status(400).json({ error: 'Missing required parameter: tableName' });
      }
      
      if (!recordId) {
        return res.status(400).json({ error: 'Missing required parameter: recordId' });
      }
      
      console.log(`Processing record ${recordId} from table ${tableName}`);
      
      // Fetch the record from Airtable
      console.log('Initializing Airtable base...');
      const base = airtable.base(process.env.AIRTABLE_BASE_ID);
      
      console.log('Fetching record from Airtable...');
      let airtableRecord;
      try {
        airtableRecord = await base(tableName).find(recordId);
      } catch (airtableError) {
        console.error('Airtable error:', airtableError.message);
        return res.status(404).json({ 
          error: 'Airtable Error',
          message: airtableError.message,
          details: {
            recordId,
            tableName,
            errorType: airtableError.name || 'Unknown'
          }
        });
      }
      
      if (!airtableRecord) {
        return res.status(404).json({ error: 'Record not found in Airtable' });
      }
      
      // Continue with the rest of your existing code...
      const fields = airtableRecord.fields;
      
      // Add detailed logging
      console.log('API called:', new Date().toISOString());
      console.log('Record ID:', recordId);
      console.log('Airtable fields available:', Object.keys(fields));
      
      // Check specific field values directly from Airtable
      console.log('==== DIRECT FIELD VALUES FROM AIRTABLE ====');
      console.log('Section directly:', fields.Section);
      console.log('Overline directly:', fields.Overline);
      console.log('URL directly:', fields.URL);
      console.log('Image URL directly:', fields['Image URL']);
      console.log('source directly:', fields.source);
      console.log('==========================================');
      
      // Add detailed logging for field names
      console.log('Available fields:', Object.keys(fields));
      console.log('Section value:', fields.section);
      console.log('Image values:', fields.imgUrl, fields.image);

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
        airtable_id: recordId,
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
        status: getField(fields, 'status', 'draft'),
        updated_at: new Date().toISOString()
      };

      // Log the data we're about to send
      console.log('Final data being sent to Supabase:', JSON.stringify(articleData, null, 2));
      
      console.log(`Mapped Airtable record to Supabase schema`)
      
      // Check if record already exists in Supabase
      const { data: existingRecords } = await supabase
        .from('articles')
        .select('id')
        .eq('airtable_id', recordId)
      
      let result
      let operation
      
      if (existingRecords && existingRecords.length > 0) {
        // Update existing record
        result = await supabase
          .from('articles')
          .update(articleData)
          .eq('airtable_id', recordId)
          .select()
        
        operation = 'updated'
        console.log(`Updated existing record in Supabase`)
      } else {
        // Insert new record
        result = await supabase
          .from('articles')
          .insert(articleData)
          .select()
        
        operation = 'created'
        console.log(`Created new record in Supabase`)
      }
      
      if (result.error) {
        console.error(`Supabase error: ${result.error.message}`)
        throw new Error(`Supabase error: ${result.error.message}`)
      }
      
      // Send success response
      return res.status(200).json({
        success: true,
        message: `Record ${operation} in Supabase successfully`,
        data: {
          id: result.data[0].id,
          title: articleData.title,
          section_id: sectionId,
          section_name: sectionValue,
          operation: operation
        }
      })
      
    } catch (innerError) {
      console.error('Error in record processing:', innerError);
      return res.status(500).json({
        error: 'Processing Error',
        message: innerError.message,
        stack: innerError.stack
      });
    }
  } catch (outerError) {
    // This catches any uncaught exceptions in the handler function
    console.error('Uncaught exception in API handler:', outerError);
    return res.status(500).json({
      error: 'Server Error',
      message: outerError.message,
      stack: outerError.stack
    });
  }
}