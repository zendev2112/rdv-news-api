import express from 'express'

const router = express.Router()

// Simple API key authentication — env only, fail closed (no hardcoded fallback).
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key']
  const validApiKey = process.env.CLIENT_API_KEY

  if (!validApiKey || apiKey !== validApiKey) {
    return res.status(401).json({ error: 'Invalid API key' })
  }
  next()
}

const TABLE = 'Redes Sociales'
const airtableAuth = () => {
  const baseId = process.env.AIRTABLE_BASE_ID
  const token = process.env.AIRTABLE_TOKEN
  if (!baseId || !token) throw new Error('Airtable credentials not configured')
  return { baseId, token }
}

// The image generator's approval queue: Redes Sociales records the editor
// ticked `aprobado` and that haven't been posted yet (`redesPublicado` unset).
// Same gate mechanism as article publishing — the tick is the editor's call.
router.get('/pending-approved', authenticateApiKey, async (req, res) => {
  try {
    const { baseId, token } = airtableAuth()
    const params = new URLSearchParams()
    params.append('filterByFormula', 'AND({aprobado}, NOT({redesPublicado}))')
    params.append('pageSize', '50')
    for (const f of ['title', 'overline', 'socialMediaText', 'imgUrl', 'section', 'created_at']) {
      params.append('fields[]', f)
    }
    const response = await fetch(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(TABLE)}?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!response.ok) {
      const errorText = await response.text()
      return res.status(response.status).json({ error: 'Airtable request failed', details: errorText })
    }
    const data = await response.json()
    res.json({
      success: true,
      records: (data.records || []).map((r) => ({
        recordId: r.id,
        title: r.fields?.title || '(sin título)',
        overline: r.fields?.overline || '',
        socialMediaText: r.fields?.socialMediaText || '',
        imgUrl: r.fields?.imgUrl || '',
        section: r.fields?.section || '',
        createdAt: r.createdTime || null,
      })),
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('pending-approved error:', error)
    res.status(500).json({ error: 'Failed to fetch approved queue', timestamp: new Date().toISOString() })
  }
})

// Proxy for Airtable GET requests
// Proxy for Airtable GET requests
router.get('/record/:recordId', authenticateApiKey, async (req, res) => {
    try {
      const { recordId } = req.params
      
      if (!recordId || !recordId.startsWith('rec')) {
        return res.status(400).json({ error: 'Invalid record ID format' })
      }
      
      const { baseId, token } = airtableAuth()
      const tableName = TABLE
      
      const airtableUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}/${recordId}`
      
      const response = await fetch(airtableUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        return res.status(response.status).json({ 
          error: 'Airtable request failed',
          details: errorText 
        })
      }
      
      const airtableData = await response.json()
      
      // LOG THE AIRTABLE RESPONSE FOR DEBUGGING
      console.log('🔍 Airtable raw response:', JSON.stringify(airtableData, null, 2))
      
      // Return the data in the same format your client expects
      res.json({
        success: true,
        data: airtableData.fields,  // This should contain title, excerpt, etc.
        recordId: airtableData.id,
        fullRecord: airtableData,   // Include full record for debugging
        timestamp: new Date().toISOString()
      })
      
    } catch (error) {
      console.error('Airtable proxy error:', error)
      res.status(500).json({ 
        error: 'Failed to fetch Airtable data',
        timestamp: new Date().toISOString() 
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

    const { baseId, token } = airtableAuth()
    const tableName = TABLE

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
    const { baseId, token } = airtableAuth()
    const tableName = TABLE

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
