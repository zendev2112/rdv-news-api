// REMOVE THESE IMPORTS FOR NOW - we'll add them back later
// import { createClient } from '@supabase/supabase-js';
// import Airtable from 'airtable';

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
  },
};

// Webhook handler for Airtable publish button
export default async function handler(req, res) {
  try {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle OPTIONS request
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    
    // Simple health check for GET requests
    if (req.method === 'GET') {
      return res.status(200).json({
        status: 'ok',
        message: 'Webhook endpoint is ready',
      });
    }

    // For POST requests, return simple debug info
    if (req.method === 'POST') {
      return res.status(200).json({
        success: true,
        message: 'Request received',
        bodyReceived: req.body || {}
      });
    }
    
    // Default response for other methods
    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'An internal server error occurred' 
    });
  }
}