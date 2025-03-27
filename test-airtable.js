require('dotenv').config();
const axios = require('axios');

// Configuration
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

// Find all tables in the base to confirm we can connect
async function listTables() {
  try {
    console.log('Checking Airtable connection...');
    console.log(`Base ID: ${AIRTABLE_BASE_ID}`);
    console.log(`Token (first 10 chars): ${AIRTABLE_TOKEN?.substring(0, 10)}...`);
    
    const url = `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables`;
    
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${AIRTABLE_TOKEN}`
      }
    });
    
    console.log('\n✅ SUCCESS! Connected to Airtable');
    console.log('Tables in this base:');
    
    response.data.tables.forEach(table => {
      console.log(`- ${table.name} (ID: ${table.id})`);
    });
    
    // Suggest which table to use
    console.log('\nFor your test script, use one of these table names as SECTION_ID');
    
  } catch (error) {
    console.error('\n❌ ERROR connecting to Airtable:');
    
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error('Response:', error.response.data);
      
      if (error.response.status === 403) {
        console.error('\nThis is a permissions issue. Your token likely:');
        console.error('1. Doesn\'t have schema.bases:read permission');
        console.error('2. Doesn\'t have access to this specific base');
        console.error('3. Has expired or is invalid');
      }
    } else {
      console.error('Error:', error.message);
    }
  }
}

// Run the test
listTables();