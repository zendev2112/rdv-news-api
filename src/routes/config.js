import express from 'express'

const router = express.Router()

// Simple API key authentication
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key']

  // Use the same key from your social-apis.js
  const validApiKey =
    process.env.CLIENT_API_KEY || 'rdv_secure_api_key_2024_xyz123'

  if (apiKey !== validApiKey) {
    return res.status(401).json({ error: 'Invalid API key' })
  }

  next()
}

// Get secure configuration for the image generator
router.get('/client-config', authenticateApiKey, (req, res) => {
  try {
    const config = {
      airtable: {
        // Use environment variables instead of hardcoded values
        baseId: process.env.AIRTABLE_BASE_ID || 'appWtDlgG21KUI3IN',
        tableName: 'Redes Sociales',
        timeout: 30000,
        maxRecords: 100,
      },
      socialApi: {
        baseUrl:
          process.env.NODE_ENV === 'production'
            ? 'https://rdv-news-api.vercel.app/api/social-media-publishing'
            : 'http://localhost:3001/api/social-media-publishing',
        version: '1.0.0',
      },
      app: {
        name: 'RDV Image Generator',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
      },
    }

    // Validate that required config exists
    if (!config.airtable.baseId) {
      return res.status(500).json({
        error: 'Server configuration incomplete',
        details: 'AIRTABLE_BASE_ID not configured',
      })
    }

    res.json({
      success: true,
      config,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Config route error:', error)
    res.status(500).json({
      error: 'Failed to get configuration',
      timestamp: new Date().toISOString(),
    })
  }
})

// Test configuration endpoint
router.get('/test-config', authenticateApiKey, (req, res) => {
  try {
    const checks = {
      airtable_base_id: !!process.env.AIRTABLE_BASE_ID,
      airtable_token: !!process.env.AIRTABLE_TOKEN,
      social_api_key: !!process.env.API_SECRET_KEY,
      environment: process.env.NODE_ENV || 'development',
    }

    const allConfigured = Object.values(checks).every((check) =>
      typeof check === 'boolean' ? check : true
    )

    res.json({
      success: true,
      configured: allConfigured,
      checks,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    res.status(500).json({
      error: 'Configuration test failed',
      timestamp: new Date().toISOString(),
    })
  }
})

export default router
