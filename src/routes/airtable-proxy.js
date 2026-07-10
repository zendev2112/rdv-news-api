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

// Shared list shape for the two queue views below.
async function listSocialQueue(res, formula, label) {
  try {
    const { baseId, token } = airtableAuth()
    const params = new URLSearchParams()
    params.append('filterByFormula', formula)
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
    console.error(`${label} error:`, error)
    res.status(500).json({ error: `Failed to fetch ${label}`, timestamp: new Date().toISOString() })
  }
}

// The image generator's WORK queue: pieces awaiting the editor's decision —
// not yet approved, not yet posted. The editor loads one, generates the
// image, and approves it from the generator (see /approve-social).
router.get('/pending-review', authenticateApiKey, (req, res) =>
  listSocialQueue(res, 'AND(NOT({aprobado}), NOT({redesPublicado}))', 'pending-review'),
)

// Approved and not yet posted — what the future publish cron will drain.
router.get('/pending-approved', authenticateApiKey, (req, res) =>
  listSocialQueue(res, 'AND({aprobado}, NOT({redesPublicado}))', 'pending-approved'),
)

// The editor's approval, from the generator: saves the EXACT image they saw
// (base64 → Cloudinary → Airtable attachment; Airtable silently drops
// data-URL attachments, so the Cloudinary hop is required) and ticks
// `aprobado` in the same call. The future cron posts exactly what was saved.
router.post('/approve-social', authenticateApiKey, async (req, res) => {
  try {
    const { recordId, imageBase64, filename } = req.body || {}
    if (!recordId || !String(recordId).startsWith('rec')) {
      return res.status(400).json({ error: 'Invalid record ID' })
    }
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'imageBase64 is required' })
    }
    const b64 = imageBase64.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(b64, 'base64')
    if (!buffer.length) return res.status(400).json({ error: 'Empty image payload' })

    const { uploadImage } = await import('../services/cloudinary.js')
    const safeName = String(filename || `social-${recordId}.jpg`).replace(/[^\w.-]/g, '_')
    const imageUrl = await uploadImage(buffer, safeName)

    const { baseId, token } = airtableAuth()
    const attachment = [{ url: imageUrl, filename: safeName }]
    const response = await fetch(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(TABLE)}/${recordId}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            social_image_instagram: attachment,
            social_image_facebook: attachment,
            social_image_twitter: attachment,
            aprobado: true,
          },
        }),
      },
    )
    if (!response.ok) {
      const errorText = await response.text()
      return res.status(response.status).json({ error: 'Airtable update failed', details: errorText })
    }
    const data = await response.json()
    res.json({
      success: true,
      recordId: data.id,
      imageUrl,
      aprobado: !!data.fields?.aprobado,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('approve-social error:', error)
    res.status(500).json({ error: 'Failed to approve', timestamp: new Date().toISOString() })
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
