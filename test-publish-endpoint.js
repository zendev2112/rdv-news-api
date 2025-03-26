const axios = require('axios');
require('dotenv').config();

// Configuration
const API_URL = `http://localhost:${process.env.PORT || 3000}`;
const RECORD_ID = 'recRdTcDW4obcWjVs' // Replace with a real Airtable record ID
const SECTION_ID = 'primera-plana'; // Replace with a real section ID from your Airtable

// Test function
async function testPublishEndpoint() {
  try {
    console.log('Testing publish endpoint...');
    
    const response = await axios.post(
      `${API_URL}/api/publish/${RECORD_ID}`,
      {
        sectionId: SECTION_ID,
        secretKey: process.env.AIRTABLE_WEBHOOK_SECRET
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(response.data, null, 2));
    console.log('Publish test completed successfully!');
    
  } catch (error) {
    console.error('Error testing publish endpoint:');
    
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received. Is your server running?');
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Error message:', error.message);
    }
  }
}

// Make sure the server is running before executing this script
console.log('Make sure your server is running on port', process.env.PORT || 3000);
console.log(`Testing with record ID: ${RECORD_ID} and section ID: ${SECTION_ID}`);

// Run the test
testPublishEndpoint();