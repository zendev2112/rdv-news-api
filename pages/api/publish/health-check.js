// Simple health check endpoint for testing connectivity from Airtable

export default function handler(req, res) {
  // Add CORS headers to allow requests from Airtable
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Return simple health status
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'API is online and reachable from Airtable'
  });
}