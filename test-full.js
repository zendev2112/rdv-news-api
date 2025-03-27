require('dotenv').config();
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Configuration
const API_URL = 'http://localhost:3000';

// Show environment configuration
console.log('Environment Configuration:');
console.log('- AIRTABLE_TOKEN:', process.env.AIRTABLE_TOKEN ? 'Configured ✓' : 'MISSING ✗');
console.log('- AIRTABLE_BASE_ID:', process.env.AIRTABLE_BASE_ID || 'MISSING ✗');
console.log('- SUPABASE_URL:', process.env.SUPABASE_URL ? 'Configured ✓' : 'MISSING ✗');
console.log('- SUPABASE_SERVICE_KEY:', process.env.SUPABASE_SERVICE_KEY ? 'Configured ✓' : 'MISSING ✗');

// Test health endpoint
async function testHealthEndpoint() {
  try {
    console.log('\nTesting health endpoint...');
    const response = await axios.get(`${API_URL}/api/health`);
    console.log('Health endpoint response:', response.data);
    return true;
  } catch (error) {
    console.error('Health endpoint error:', error.message);
    return false;
  }
}

// Test Airtable connection
async function testAirtableConnection() {
  try {
    console.log('\nTesting Airtable connection...');
    const response = await axios.get(`${API_URL}/api/test/airtable`);
    console.log('Airtable connection response:', response.data);
    
    // Return first table name and a random record ID for testing
    if (response.data.tables && response.data.tables.length > 0) {
      return { 
        success: true, 
        tableName: response.data.tables[0].name 
      };
    } else {
      console.log('No tables found in Airtable base');
      return { success: false };
    }
  } catch (error) {
    console.error('Airtable connection error:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response:', error.response.data);
    } else {
      console.error('Error:', error.message);
    }
    return { success: false };
  }
}

// Test Supabase connection
async function testSupabaseConnection() {
  try {
    console.log('\nTesting Supabase connection...');
    const response = await axios.get(`${API_URL}/api/test/supabase`);
    console.log('Supabase connection response:', response.data);
    return true;
  } catch (error) {
    console.error('Supabase connection error:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response:', error.response.data);
    } else {
      console.error('Error:', error.message);
    }
    return false;
  }
}

// Check Supabase table schema
async function checkSupabaseSchema() {
  try {
    console.log('\nChecking Supabase table schema...');
    
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
    
    const { data, error } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type, is_nullable')
      .eq('table_name', 'articles');
    
    if (error) throw error;
    
    console.log('Articles table schema:');
    data.forEach(col => {
      console.log(`- ${col.column_name} (${col.data_type}, ${col.is_nullable === 'YES' ? 'nullable' : 'not nullable'})`);
    });
    
    // Check for required columns
    const requiredColumns = ['title', 'content', 'airtable_id'];
    const missingColumns = requiredColumns.filter(col => !data.some(c => c.column_name === col));
    
    if (missingColumns.length > 0) {
      console.warn(`⚠️ Missing required columns: ${missingColumns.join(', ')}`);
    }
    
    // Check for section vs section_id
    if (data.some(c => c.column_name === 'section')) {
      console.log('✓ Found "section" column');
    } else if (data.some(c => c.column_name === 'section_id')) {
      console.log('✓ Found "section_id" column');
    } else {
      console.warn('⚠️ Missing both "section" and "section_id" columns');
    }
    
    return {
      columns: data.map(col => col.column_name),
      hasSection: data.some(c => c.column_name === 'section'),
      hasSectionId: data.some(c => c.column_name === 'section_id')
    };
  } catch (error) {
    console.error('Error checking Supabase schema:', error.message);
    return { columns: [] };
  }
}

// Get a test record ID from Airtable to use for testing
async function getTestRecordId(tableName) {
  try {
    console.log(`\nFetching a test record from table: ${tableName}`);
    
    const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`;
    
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`
      },
      params: {
        maxRecords: 1,
        view: 'Grid view'
      }
    });
    
    if (response.data.records && response.data.records.length > 0) {
      const recordId = response.data.records[0].id;
      console.log(`Found record ID: ${recordId}`);
      return recordId;
    } else {
      console.log('No records found in table');
      return null;
    }
  } catch (error) {
    console.error('Error fetching test record:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response:', error.response.data);
    } else {
      console.error('Error:', error.message);
    }
    return null;
  }
}

// Test the publish endpoint
async function testPublishEndpoint(recordId, tableName) {
  try {
    console.log('\nTesting publish endpoint...');
    console.log(`POST ${API_URL}/api/publish/${recordId}`);
    console.log(`Table: ${tableName}`);
    
    const payload = {
      tableName: tableName,
      secretKey: process.env.AIRTABLE_WEBHOOK_SECRET
    };
    
    const response = await axios.post(
      `${API_URL}/api/publish/${recordId}`,
      payload,
      { headers: { 'Content-Type': 'application/json' } }
    );
    
    console.log('Publish endpoint response:', response.data);
    return true;
  } catch (error) {
    console.error('Publish endpoint error:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response:', error.response.data);
    } else {
      console.error('Error:', error.message);
    }
    return false;
  }
}

// Run the tests
async function runTests() {
  // 1. Test health endpoint
  const healthOk = await testHealthEndpoint();
  if (!healthOk) {
    console.error('\n⚠️ Health endpoint failed. Make sure your server is running.');
    return;
  }
  
  // 2. Test Airtable connection
  const airtableResult = await testAirtableConnection();
  if (!airtableResult.success) {
    console.error('\n⚠️ Airtable connection failed. Check your credentials.');
    return;
  }
  
  // 3. Test Supabase connection and check schema
  const supabaseOk = await testSupabaseConnection();
  if (!supabaseOk) {
    console.error('\n⚠️ Supabase connection failed. Check your credentials.');
    return;
  }
  
  // Check schema before continuing
  const schemaInfo = await checkSupabaseSchema();
  console.log('\nSupabase schema compatibility:');
  if (!schemaInfo.hasSection && !schemaInfo.hasSectionId) {
    console.error('⚠️ Your Supabase table is missing both "section" and "section_id" columns.');
    console.error('Please add one of these columns or update your code to match your schema.');
  } else {
    console.log(`✓ Using column: ${schemaInfo.hasSection ? 'section' : 'section_id'}`);
  }
  
  // 4. Get a test record ID
  const recordId = await getTestRecordId(airtableResult.tableName);
  if (!recordId) {
    console.error('\n⚠️ Could not find a test record. Make sure your table has data.');
    return;
  }
  
  // 5. Test the publish endpoint
  const publishOk = await testPublishEndpoint(recordId, airtableResult.tableName);
  if (publishOk) {
    console.log('\n✅ All tests passed successfully!');
  } else {
    console.error('\n⚠️ Publish endpoint failed. Check the error messages above.');
  }
}

// Run the tests
runTests();