// Minimal API handler without any imports
export default function handler(req, res) {
  // Basic CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  
  // Simple response
  res.status(200).json({ status: 'ok', message: 'Webhook endpoint ready' });
}