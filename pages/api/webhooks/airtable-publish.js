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
    
    // Handle OPTIONS request
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // For testing - return simple success
    return res.status(200).json({ 
      success: true, 
      message: "Webhook endpoint is responding",
      received: req.body,
      env: {
        hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
        hasSupabaseKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
        hasAirtableKey: Boolean(process.env.AIRTABLE_API_KEY),
        hasAirtableBaseId: Boolean(process.env.AIRTABLE_BASE_ID)
      }
    });
    
    /* Once this works, uncomment the implementation below
    
    // Only accept POST requests for actual processing
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
    
    // Initialize clients inside the handler function
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    const airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY });
    
    // Extract record ID and section ID from webhook payload
    const recordId = req.body.recordId || 
                    (req.body.record && req.body.record.id) || 
                    (req.body.payload && req.body.payload.recordId);
    
    const sectionId = req.body.sectionId || 
                     (req.body.payload && req.body.payload.sectionId) || 
                     'primera-plana';
    
    if (!recordId) {
      return res.status(400).json({ success: false, error: 'No record ID provided' });
    }
    
    // Fetch the record from Airtable
    const base = airtable.base(process.env.AIRTABLE_BASE_ID);
    const airtableRecord = await base(sectionId).find(recordId);
    
    if (!airtableRecord) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }
    
    // Rest of your processing code
    */
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
}