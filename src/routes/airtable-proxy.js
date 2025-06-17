import express from 'express'

const router = express.Router()

// Simple API key authentication
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key']
  const validApiKey =
    process.env.CLIENT_API_KEY || 'rdv_secure_api_key_2024_xyz123'

  if (apiKey !== validApiKey) {
    return res.status(401).json({ error: 'Invalid API key' })
  }
  next()
}

// Proxy for Airtable GET requests
router.get('/record/:recordId', authenticateApiKey, async (req, res) => {
  try {
    const { recordId } = req.params

    // Validate record ID format
    if (!recordId || !recordId.startsWith('rec')) {
      return res.status(400).json({ error: 'Invalid record ID format' })
    }

    const baseId = process.env.AIRTABLE_BASE_ID || 'appWtDlgG21KUI3IN'
    const tableName = 'Redes Sociales'
    const token =
      process.env.AIRTABLE_TOKEN ||
      'patlPzRF8YzZNnogn.8b3d2d68528bfa5b0643a212f832966d1a327f6ca85e8c0f373609452318af4c'

    const airtableUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
      tableName
    )}/${recordId}`

    const response = await fetch(airtableUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      return res.status(response.status).json({
        error: 'Airtable request failed',
        details: errorText,
      })
    }

    const data = await response.json()

    res.json({
      success: true,
      data: data.fields,
      recordId: data.id,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Airtable proxy error:', error)
    res.status(500).json({
      error: 'Failed to fetch Airtable data',
      timestamp: new Date().toISOString(),
    })
  }
})

// Proxy for Airtable PATCH requests (updates)
router.patch('/record/:recordId', authenticateApiKey, async (req, res) => {
  try {
    const { recordId } = req.params
    const { fields } = req.body

    if (!recordId || !recordId.startsWith('rec')) {
      return res.status(400).json({ error: 'Invalid record ID format' })
    }

    if (!fields || typeof fields !== 'object') {
      return res.status(400).json({ error: 'Invalid fields data' })
    }

    const baseId = process.env.AIRTABLE_BASE_ID || 'appWtDlgG21KUI3IN'
    const tableName = 'Redes Sociales'
    const token =
      process.env.AIRTABLE_TOKEN ||
      'patlPzRF8YzZNnogn.8b3d2d68528bfa5b0643a212f832966d1a327f6ca85e8c0f373609452318af4c'

    const airtableUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
      tableName
    )}/${recordId}`

    const response = await fetch(airtableUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return res.status(response.status).json({
        error: 'Airtable update failed',
        details: errorText,
      })
    }

    const data = await response.json()

    res.json({
      success: true,
      data: data.fields,
      recordId: data.id,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Airtable update error:', error)
    res.status(500).json({
      error: 'Failed to update Airtable data',
      timestamp: new Date().toISOString(),
    })
  }
})

// Test Airtable connection
router.get('/test-connection', authenticateApiKey, async (req, res) => {
  try {
    const baseId = process.env.AIRTABLE_BASE_ID || 'appWtDlgG21KUI3IN'
    const tableName = 'Redes Sociales'
    const token =
      process.env.AIRTABLE_TOKEN ||
      'patlPzRF8YzZNnogn.8b3d2d68528bfa5b0643a212f832966d1a327f6ca85e8c0f373609452318af4c'

    const airtableUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
      tableName
    )}?maxRecords=1`

    const response = await fetch(airtableUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

    const success = response.ok
    const statusCode = response.status

    res.json({
      success,
      statusCode,
      message: success
        ? 'Airtable connection successful'
        : 'Airtable connection failed',
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Airtable test error:', error)
    res.status(500).json({
      error: 'Connection test failed',
      timestamp: new Date().toISOString(),
    })
  }
})

export default router
