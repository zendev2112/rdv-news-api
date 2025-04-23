import axios from 'axios';

// This endpoint serves as a simple proxy for Airtable scripts
// It receives requests from Airtable and forwards them to your main API
export default async function handler(req, res) {
  // Set CORS headers to allow requests from anywhere (including Airtable)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    // Extract record ID and table name from the request
    const { recordId, tableName, secretKey } = req.body;
    
    if (!recordId || !tableName || !secretKey) {
      return res.status(400).json({ 
        error: 'Bad Request', 
        message: 'Missing required parameters: recordId, tableName, or secretKey' 
      });
    }
    
    // Get the base URL of the current deployment
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'https://rdv-news-api.vercel.app';
    
    console.log(`Proxying request for record ${recordId} from table ${tableName} to ${baseUrl}/api/publish/${recordId}`);
    
    // Forward the request to the main API endpoint
    const apiResponse = await axios.post(
      `${baseUrl}/api/publish/${recordId}`,
      { tableName, secretKey },
      { headers: { 'Content-Type': 'application/json' } }
    );
    
    // Return the API response directly
    return res.status(apiResponse.status).json(apiResponse.data);
    
  } catch (error) {
    console.error('Proxy error:', error);
    
    // If we got a response from the API but with an error status
    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }
    
    // For network errors or other issues
    return res.status(500).json({
      error: 'Proxy Error',
      message: error.message
    });
  }
}