import { createClient } from '@supabase/supabase-js';
import Airtable from 'airtable';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize Airtable
const airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY });

/**
 * Map section to section_id
 */
function mapSectionToId(sectionValue) {
  const sectionMapping = {
    'Politica': 'politica',
    'Economia': 'economia',
    'Agro': 'agro',
    // Add more mappings as needed
  };
  
  return sectionMapping[sectionValue] || 'politica';
}

/**
 * Extract field from record safely
 */
function getField(fields, name, defaultValue = '') {
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

// Config for API handler
export const config = {
  api: {
    bodyParser: true,
    externalResolver: true,
  },
};

// Webhook handler for Airtable publish button
export default async function handler(req, res) {
  try {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle OPTIONS request (preflight CORS check)
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // Only accept POST requests
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    console.log('Webhook received:', JSON.stringify(req.body, null, 2));
    
    // Extract record ID and section ID from webhook payload
    const recordId = req.body.recordId || 
                    (req.body.record && req.body.record.id) || 
                    (req.body.payload && req.body.payload.recordId);
    
    const sectionId = req.body.sectionId || 
                     (req.body.payload && req.body.payload.sectionId) || 
                     'primera-plana'; // Default if not specified
    
    if (!recordId) {
      console.error('No record ID found in webhook payload');
      return res.status(400).json({ success: false, error: 'No record ID provided' });
    }
    
    console.log(`Processing record ${recordId} from section ${sectionId}`);
    
    // Fetch the record from Airtable
    const base = airtable.base(process.env.AIRTABLE_BASE_ID);
    
    let airtableRecord;
    try {
      airtableRecord = await base(sectionId).find(recordId);
    } catch (airtableError) {
      console.error('Airtable error:', airtableError.message);
      return res.status(404).json({ 
        success: false,
        error: 'Airtable Error',
        message: airtableError.message
      });
    }
    
    if (!airtableRecord) {
      return res.status(404).json({ 
        success: false, 
        error: 'Record not found in Airtable' 
      });
    }
    
    // Map all Airtable fields to Supabase schema
    const fields = airtableRecord.fields;
    
    // Log available fields for debugging
    console.log('Available fields from Airtable:', Object.keys(fields));
    
    // Get section value and map to section_id
    const sectionValue = getField(fields, 'section', 'Politica');
    const mappedSectionId = mapSectionToId(sectionValue);
    
    // Prepare article data for Supabase
    const articleData = {
      id: recordId, // Using Airtable record ID as primary key
      title: getField(fields, 'title', ''),
      overline: getField(fields, 'overline', ''),
      excerpt: getField(fields, 'excerpt', ''),
      article: getField(fields, 'article', ''),
      url: getField(fields, 'url', ''),
      source: getField(fields, 'source', ''),
      image: fields.image ? JSON.stringify(fields.image) : null,
      img_url: getField(fields, 'imgUrl', ''),
      article_images: getField(fields, 'article-images', ''),
      ig_post: getField(fields, 'ig-post', ''),
      fb_post: getField(fields, 'fb-post', ''),
      tw_post: getField(fields, 'tw-post', ''),
      yt_video: getField(fields, 'yt-video', ''),
      status: getField(fields, 'status', 'draft'),
      section: getField(fields, 'section', ''),
      section_id: mappedSectionId,
      updated_at: new Date().toISOString()
    };
    
    console.log('Prepared article data for Supabase:', JSON.stringify({
      id: articleData.id,
      title: articleData.title,
      section: articleData.section,
      status: articleData.status
    }));

    // Insert or update in Supabase
    const { data, error } = await supabase
      .from('articles')
      .upsert(articleData, {
        onConflict: 'id',
        returning: 'representation',
      });

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }

    console.log('Successfully published to Supabase with ID:', data[0].id);

    // Return success response
    return res.status(200).json({
      success: true,
      message: `Record successfully published to Supabase`,
      data: {
        id: data[0].id,
        title: data[0].title,
        section: data[0].section,
        section_id: data[0].section_id,
        status: data[0].status,
      }
    });
    
  } catch (error) {
    console.error('Error handling webhook:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}