const express = require('express');
const router = express.Router();
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Add this at the beginning of your file, after the initial imports
router.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'API is running'
  });
});

// Add this helper function for generating slugs
function generateSlug(title) {
  if (!title) return 'untitled-' + Date.now();
  
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Remove consecutive hyphens
    .trim();
}

// Get the Airtable record by ID
async function getAirtableRecord(recordId, tableName) {
  try {
    const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}/${recordId}`;
    
    console.log(`Fetching Airtable record: ${recordId} from table: ${tableName}`);
    console.log(`URL: ${url}`);
    
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`
      }
    });
    
    console.log(`Successfully fetched record from Airtable: ${recordId}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching from Airtable:', error);
    
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error('Response:', error.response.data);
    }
    
    throw error;
  }
}

// Get Supabase table columns to ensure we match the schema
async function getSupabaseTableColumns() {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
    
    const { data, error } = await supabase
      .from('information_schema.columns')
      .select('column_name')
      .eq('table_name', 'articles');
    
    if (error) throw error;
    
    return data.map(col => col.column_name);
  } catch (error) {
    console.error('Error fetching Supabase schema:', error);
    return null;
  }
}

// Create or update record in Supabase
async function publishToSupabase(record, tableName) {
  try {
    console.log('Publishing to Supabase:', record.id);
    
    // Initialize Supabase client
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
    
    // Get table columns to make sure we match the schema
    const columns = await getSupabaseTableColumns();
    console.log('Supabase table columns:', columns);
    
    // Extract title from different possible field names
    const title = record.fields.title || record.fields.Title || '';
    
    // Generate slug from title, or use provided slug if available
    const slug = record.fields.slug || generateSlug(title);
    
    // Map Airtable fields to Supabase schema
    const articleData = {
      title: title,
      content: record.fields.content || record.fields.Content || record.fields.article || '',
      excerpt: record.fields.excerpt || record.fields.Excerpt || record.fields.bajada || '',
      section_id: tableName,
      
      // Add slug to satisfy NOT NULL constraint
      slug: slug,
      
      airtable_id: record.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    // Add image_url if available
    if (record.fields.image_url || record.fields.imagen) {
      articleData.image_url = record.fields.image_url || record.fields.imagen;
    }
    
    // Add author if available
    if (record.fields.author || record.fields.autor) {
      articleData.author = record.fields.author || record.fields.autor;
    }
    
    // Remove any fields that don't exist in the Supabase table
    if (columns) {
      Object.keys(articleData).forEach(key => {
        if (!columns.includes(key)) {
          console.log(`Removing field '${key}' as it doesn't exist in Supabase schema`);
          delete articleData[key];
        }
      });
      
      // Handle section vs section_id based on schema
      if (columns.includes('section') && !columns.includes('section_id')) {
        console.log('Schema has "section" but not "section_id", adjusting data');
        articleData.section = tableName;
        delete articleData.section_id;
      }
      
      // Make sure slug is included if it's required
      if (columns.includes('slug') && !articleData.slug) {
        console.log('Generating slug for article');
        articleData.slug = generateSlug(title || 'article') + '-' + Date.now();
      }
    }
    
    console.log('Final article data for Supabase:', articleData);
    
    // Insert or update in Supabase
    const { data, error } = await supabase
      .from('articles')
      .upsert(articleData, { 
        onConflict: 'airtable_id', 
        returning: 'representation' 
      });
    
    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }
    
    // Check if data is null or empty before accessing it
    if (!data || data.length === 0) {
      console.log('Upsert succeeded but no data was returned');
      // Return a manually constructed response based on what we sent
      return {
        id: null, // We don't know the ID that Supabase assigned
        title: articleData.title,
        slug: articleData.slug,
        airtable_id: articleData.airtable_id,
        // Include any other fields you need in your response
      };
    }
    
    console.log('Successfully published to Supabase:', data[0].id);
    return data[0];
  } catch (error) {
    console.error('Error publishing to Supabase:', error);
    throw error;
  }
}

// Publish endpoint
router.post('/api/publish/:recordId', async (req, res) => {
  try {
    const { recordId } = req.params;
    const { tableName, secretKey } = req.body;
    
    console.log('Publish request received:');
    console.log('- Record ID:', recordId);
    console.log('- Table Name:', tableName);
    
    // Validate inputs
    if (!recordId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Record ID is required' 
      });
    }
    
    if (!tableName) {
      return res.status(400).json({ 
        success: false, 
        error: 'Table name is required' 
      });
    }
    
    // Basic security check
    if (secretKey !== process.env.AIRTABLE_WEBHOOK_SECRET) {
      return res.status(401).json({ 
        success: false, 
        error: 'Unauthorized: Invalid secret key' 
      });
    }
    
    // 1. Get record from Airtable
    console.log('Fetching record from Airtable...');
    let record;
    try {
      record = await getAirtableRecord(recordId, tableName);
    } catch (airtableError) {
      return res.status(500).json({
        success: false,
        error: `Airtable error: ${airtableError.message}`,
        details: airtableError.response?.data || {}
      });
    }
    
    if (!record) {
      return res.status(404).json({ 
        success: false, 
        error: 'Record not found in Airtable' 
      });
    }
    
    console.log('Record fetched successfully:', record.id);
    
    // 2. Publish to Supabase
    console.log('Publishing to Supabase...');
    try {
      const publishedRecord = await publishToSupabase(record, tableName);
      
      // 3. Return success response with fallback values if properties are undefined
      return res.status(200).json({
        success: true,
        message: 'Record published successfully',
        data: {
          id: publishedRecord?.id || 'unknown',
          title: publishedRecord?.title || '',
          slug: publishedRecord?.slug || '',
          airtable_id: publishedRecord?.airtable_id || record.id
        }
      });
    } catch (supabaseError) {
      // More detailed error for Supabase issues
      console.error('Supabase error:', supabaseError);
      
      return res.status(500).json({
        success: false,
        error: 'Failed to publish record to Supabase',
        message: supabaseError.message,
        details: supabaseError.details || supabaseError.code || '',
        errorId: Math.random().toString(16).slice(2, 10) // For tracking in logs
      });
    }
    
  } catch (error) {
    console.error('Error in publish endpoint:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Failed to publish record',
      message: error.message,
      errorId: Math.random().toString(16).slice(2, 10) // For tracking in logs
    });
  }
});

// Add a test route for this router
router.get('/api/publish/test', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Publish endpoint is working',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;