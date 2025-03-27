const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const publishRouter = require('./routes/publish');
require('dotenv').config();

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Enable CORS for all routes
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Root route handler - add this to fix the "Cannot GET /" error
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>RDV News API</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          h1 { color: #2c3e50; }
          .endpoint { background: #f8f9fa; padding: 10px; margin-bottom: 10px; border-radius: 4px; }
          code { background: #eee; padding: 2px 4px; border-radius: 3px; }
          .success { color: green; }
          .note { color: #7f8c8d; font-style: italic; }
        </style>
      </head>
      <body>
        <h1>RDV News API</h1>
        <p class="success">✅ The API is running successfully!</p>
        <p>This API provides endpoints to publish Airtable records to Supabase.</p>
        
        <h2>Available Endpoints:</h2>
        
        <div class="endpoint">
          <h3>Health Check</h3>
          <p><code>GET /api/health</code> - Check if the API is running</p>
          <p>Try it: <a href="/api/health" target="_blank">/api/health</a></p>
        </div>
        
        <div class="endpoint">
          <h3>Publish Record</h3>
          <p><code>POST /api/publish/:recordId</code> - Publish an Airtable record to Supabase</p>
          <p>Required body parameters:</p>
          <ul>
            <li><code>tableName</code> - The name of the Airtable table</li>
            <li><code>secretKey</code> - Authentication secret key</li>
          </ul>
        </div>
        
        <div class="endpoint">
          <h3>Test Endpoint</h3>
          <p><code>GET /api/publish/test</code> - Test if the publish module is working</p>
          <p>Try it: <a href="/api/publish/test" target="_blank">/api/publish/test</a></p>
        </div>
        
        <p class="note">Note: If you're seeing this page through ngrok, your setup is working correctly!</p>
      </body>
    </html>
  `);
});

// Health check endpoint - ensure this is present
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'API is running',
    version: '1.0.0'
  });
});

// Simple test endpoint to check Airtable access
app.get('/api/test/airtable', async (req, res) => {
  const axios = require('axios');
  
  try {
    // Create the Airtable API URL to list tables
    const url = `https://api.airtable.com/v0/meta/bases/${process.env.AIRTABLE_BASE_ID}/tables`;
    
    // Make the request with your token
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`
      }
    });
    
    res.json({
      success: true,
      message: 'Successfully connected to Airtable',
      tables: response.data.tables.map(table => ({ 
        name: table.name, 
        id: table.id 
      }))
    });
    
  } catch (error) {
    console.error('Airtable connection error:', error);
    
    res.status(500).json({
      success: false,
      error: 'Failed to connect to Airtable',
      details: error.response?.data || error.message
    });
  }
});

// Simple test endpoint to check Supabase access
app.get('/api/test/supabase', async (req, res) => {
  const { createClient } = require('@supabase/supabase-js');
  
  try {
    // Create Supabase client
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
    
    // Test if we can access the tables
    const { data, error } = await supabase
      .from('articles')
      .select('id')
      .limit(1);
      
    if (error) throw error;
    
    res.json({
      success: true,
      message: 'Successfully connected to Supabase',
      data: data
    });
    
  } catch (error) {
    console.error('Supabase connection error:', error);
    
    res.status(500).json({
      success: false,
      error: 'Failed to connect to Supabase',
      details: error.message
    });
  }
});

// Use publish router for /api/publish routes
app.use(publishRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Server error',
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
  });
});

// 404 handler for undefined routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
    message: `The requested endpoint ${req.method} ${req.originalUrl} does not exist`
  });
});

// Start the server, binding to all interfaces (0.0.0.0) for ngrok compatibility
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ===============================================
  🚀 RDV News API Server running on port ${PORT}
  
  - Local URL: http://localhost:${PORT}
  - Health Check: http://localhost:${PORT}/api/health
  
  If using ngrok, update your scripts with the ngrok URL
  ===============================================
  `);
});

// Export app for testing
module.exports = app;