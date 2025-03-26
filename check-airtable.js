const axios = require('axios');
const config = require('./src/config');

async function checkAirtableAccess() {
  console.log('Checking Airtable configuration...');
  console.log(`Base ID: ${config.airtable.baseId}`);
  console.log(`Token: ${config.airtable.personalAccessToken ? '✓ Set' : '❌ Missing'}`);
  
  console.log('\nChecking table access for each section:');
  
  for (const section of config.sections) {
    console.log(`\nSection: ${section.name}`);
    console.log(`ID: ${section.id}`);
    console.log(`Table Name: ${section.tableName || '❌ Missing'}`);
    
    if (!section.tableName) {
      console.log('❌ ERROR: Missing tableName property for section');
      continue;
    }
    
    try {
      const url = `https://api.airtable.com/v0/${config.airtable.baseId}/${section.tableName}?maxRecords=1`;
      console.log(`Testing URL: ${url}`);
      
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${config.airtable.personalAccessToken}`,
        }
      });
      
      console.log('✓ SUCCESS: Table exists and is accessible');
      console.log(`Table structure: ${Object.keys(response.data.records[0]?.fields || {}).join(', ') || 'No records found'}`);
    } catch (error) {
      console.log(`❌ ERROR: Could not access table`);
      
      if (error.response) {
        console.log(`Status: ${error.response.status}`);
        console.log(`Message: ${JSON.stringify(error.response.data)}`);
      } else {
        console.log(`Error: ${error.message}`);
      }
    }
  }
}

checkAirtableAccess()
  .then(() => console.log('\nCheck completed'))
  .catch(err => console.error('Check failed:', err.message));