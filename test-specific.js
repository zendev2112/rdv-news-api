require('dotenv').config();
const axios = require('axios');

// Configure with your specific record details
const RECORD_ID = 'recPOZ1urGa2h3nMX' // Your specific Airtable record ID
const TABLE_NAME = 'Primera Plana';     // Your Airtable table name
const API_URL = 'http://localhost:3000';
const SECRET_KEY = process.env.AIRTABLE_WEBHOOK_SECRET;

async function publishSpecificRecord() {
  try {
    console.log(`Publishing record ${RECORD_ID} from table ${TABLE_NAME}...`);
    console.log(`Using API URL: ${API_URL}`);
    
    // First test the API health endpoint
    console.log('Testing API health endpoint...');
    try {
      const healthResponse = await axios.get(`${API_URL}/api/health`);
      console.log(`Health check successful: ${healthResponse.status}`);
      console.log(healthResponse.data);
    } catch (healthError) {
      console.error(`WARNING: Health check failed: ${healthError.message}`);
      console.error('Continuing with publish request anyway...');
    }
    
    // Proceed with the publish request
    console.log('Sending publish request...');
    const response = await axios.post(
      `${API_URL}/api/publish/${RECORD_ID}`,
      {
        tableName: TABLE_NAME,
        secretKey: SECRET_KEY
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );
    
    console.log('SUCCESS! Record published to Supabase:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('FAILED TO PUBLISH RECORD:');
    
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error('Response:', error.response.data);
    } else if (error.request) {
      console.error('No response received:', error.message);
    } else {
      console.error('Error:', error.message);
    }
  }
}

// Run the function
publishSpecificRecord();