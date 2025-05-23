import express from 'express'
import fs from 'fs'
import path from 'path'
import os from 'os'
import Airtable from 'airtable'
import fetch from 'node-fetch'
import logger from '../utils/logger.js'

const router = express.Router()

// Ensure temp directory exists
const TEMP_DIR = path.join(os.tmpdir(), 'rdv-images')
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true })
}

// Canva API configuration
const CANVA_API_BASE = 'https://api.canva.com/rest/v1'
const CANVA_API_TOKEN = process.env.CANVA_API_TOKEN

// Platform template IDs - you'll need to create these in Canva
const PLATFORM_TEMPLATES = {
  facebook: process.env.CANVA_FACEBOOK_TEMPLATE_ID,
  instagram: process.env.CANVA_INSTAGRAM_TEMPLATE_ID,
  twitter: process.env.CANVA_TWITTER_TEMPLATE_ID,
}

/**
 * Generate image using Canva API
 */
async function generateWithCanva(options) {
  const {
    title,
    overline = '',
    backgroundUrl = null,
    platform = 'facebook',
  } = options

  try {
    // Get template ID for platform
    const templateId = PLATFORM_TEMPLATES[platform.toLowerCase()]
    if (!templateId) {
      throw new Error(`No template configured for platform: ${platform}`)
    }

    // Step 1: Create autofill job
    const autofillResponse = await fetch(`${CANVA_API_BASE}/autofills`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CANVA_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        brand_template_id: templateId,
        data: {
          // Map your data to Canva template fields
          title: title,
          overline: overline || '',
          background_image: backgroundUrl || '',
        },
      }),
    })

    if (!autofillResponse.ok) {
      const error = await autofillResponse.json()
      throw new Error(
        `Canva autofill failed: ${error.message || autofillResponse.statusText}`
      )
    }

    const autofillData = await autofillResponse.json()
    const designId = autofillData.job.result.designs[0].id

    logger.info(`Created Canva design: ${designId}`)

    // Step 2: Export the design
    const exportResponse = await fetch(`${CANVA_API_BASE}/exports`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CANVA_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        design_id: designId,
        format: 'png',
        quality: 'high',
      }),
    })

    if (!exportResponse.ok) {
      const error = await exportResponse.json()
      throw new Error(
        `Canva export failed: ${error.message || exportResponse.statusText}`
      )
    }

    const exportData = await exportResponse.json()
    const exportJobId = exportData.job.id

    // Step 3: Wait for export to complete and get download URL
    let downloadUrl = null
    let attempts = 0
    const maxAttempts = 30 // 30 seconds max wait

    while (!downloadUrl && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1000)) // Wait 1 second

      const statusResponse = await fetch(
        `${CANVA_API_BASE}/exports/${exportJobId}`,
        {
          headers: {
            Authorization: `Bearer ${CANVA_API_TOKEN}`,
          },
        }
      )

      if (statusResponse.ok) {
        const statusData = await statusResponse.json()

        if (statusData.job.status === 'success') {
          downloadUrl = statusData.job.result.exports[0].url
          break
        } else if (statusData.job.status === 'failed') {
          throw new Error('Canva export job failed')
        }
      }

      attempts++
    }

    if (!downloadUrl) {
      throw new Error('Canva export timed out')
    }

    // Step 4: Download the image
    const imageResponse = await fetch(downloadUrl)
    if (!imageResponse.ok) {
      throw new Error(`Failed to download image: ${imageResponse.statusText}`)
    }

    const imageBuffer = await imageResponse.buffer()

    // Save to temp file
    const outputPath = path.join(TEMP_DIR, `${platform}-${Date.now()}.png`)
    fs.writeFileSync(outputPath, imageBuffer)

    logger.info(`Generated image: ${outputPath}`)
    return outputPath
  } catch (error) {
    logger.error('Error generating image with Canva:', error)
    throw error
  }
}

/**
 * Upload image to Airtable as attachment
 */
async function uploadToAirtable(imagePath, recordId, platform) {
  try {
    const apiKey = process.env.AIRTABLE_TOKEN
    const baseId = process.env.AIRTABLE_BASE_ID

    if (!apiKey || !baseId) {
      throw new Error('Missing Airtable credentials')
    }

    // Create filename
    const timestamp = new Date().toISOString().slice(0, 10)
    const filename = `${platform}-${timestamp}.png`

    // Read image file
    const imageBuffer = fs.readFileSync(imagePath)
    const base64Content = imageBuffer.toString('base64')

    // Initialize Airtable
    const airtable = new Airtable({ apiKey })
    const base = airtable.base(baseId)

    // Create field name based on platform
    const fieldName = `social_image_${platform.toLowerCase()}`

    // Create update object
    const updateFields = {}
    updateFields[fieldName] = [
      {
        filename,
        type: 'image/png',
        _base64Content: base64Content,
      },
    ]

    // Update Airtable record
    const record = await base('Redes Sociales').update(recordId, updateFields)

    return record.fields[fieldName] && record.fields[fieldName][0]
      ? record.fields[fieldName][0].url
      : null
  } catch (error) {
    logger.error('Error uploading to Airtable:', error)
    throw error
  }
}

/**
 * API endpoint for Airtable button
 * GET /api/social-media-images/airtable-generate
 */
router.get('/airtable-generate', async (req, res) => {
  try {
    const {
      recordId,
      title,
      overline = '',
      imgUrl = null,
      platform = 'facebook',
    } = req.query

    if (!recordId || !title) {
      return res.status(400).send(`
        <html>
          <head><title>Error</title></head>
          <body>
            <h1 style="color: red;">Missing Required Parameters</h1>
            <p>Record ID and title are required.</p>
          </body>
        </html>
      `)
    }

    // Generate image with Canva
    const imagePath = await generateWithCanva({
      title,
      overline,
      backgroundUrl: imgUrl,
      platform,
    })

    // Convert to base64 for preview
    const imageBuffer = fs.readFileSync(imagePath)
    const base64Image = imageBuffer.toString('base64')

    // Escape values for JavaScript
    const escapedTitle = title.replace(/"/g, '\\"').replace(/\n/g, '\\n')
    const escapedOverline = overline.replace(/"/g, '\\"').replace(/\n/g, '\\n')
    const escapedImgUrl = imgUrl ? imgUrl.replace(/"/g, '\\"') : ''

    const htmlContent = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Social Media Image Preview</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      body { 
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; 
        margin: 0; 
        padding: 20px; 
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .container {
        max-width: 800px;
        width: 100%;
        background: white;
        border-radius: 20px;
        padding: 40px;
        box-shadow: 0 20px 40px rgba(0,0,0,0.1);
        text-align: center;
      }
      .header {
        margin-bottom: 30px;
      }
      h1 { 
        color: #2d3748;
        margin: 0 0 10px 0;
        font-size: 28px;
        font-weight: 700;
      }
      .subtitle { 
        color: #718096;
        margin: 0;
        font-size: 16px;
        font-weight: 500;
      }
      .platform-badge {
        display: inline-block;
        background: #667eea;
        color: white;
        padding: 6px 16px;
        border-radius: 20px;
        font-size: 14px;
        font-weight: 600;
        text-transform: capitalize;
        margin-top: 10px;
      }
      .image-container {
        margin: 30px 0;
        padding: 20px;
        background: #f7fafc;
        border-radius: 16px;
        border: 2px dashed #e2e8f0;
      }
      .image { 
        max-width: 100%;
        height: auto;
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.15);
        transition: transform 0.3s ease;
      }
      .image:hover {
        transform: scale(1.02);
      }
      .actions {
        display: flex;
        gap: 15px;
        justify-content: center;
        margin-top: 30px;
      }
      .button {
        padding: 14px 28px;
        border: none;
        border-radius: 10px;
        font-weight: 600;
        font-size: 16px;
        cursor: pointer;
        transition: all 0.3s ease;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .button:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(0,0,0,0.15);
      }
      .button:active {
        transform: translateY(0);
      }
      .save { 
        background: linear-gradient(135deg, #48bb78, #38a169);
        color: white;
      }
      .save:hover {
        background: linear-gradient(135deg, #38a169, #2f855a);
      }
      .cancel { 
        background: #f7fafc;
        color: #4a5568;
        border: 2px solid #e2e8f0;
      }
      .cancel:hover {
        background: #edf2f7;
        border-color: #cbd5e0;
      }
      .message { 
        padding: 16px 20px;
        margin-top: 20px;
        border-radius: 10px;
        display: none;
        font-weight: 500;
      }
      .success { 
        background: linear-gradient(135deg, #c6f6d5, #9ae6b4);
        color: #1a365d;
        border: 1px solid #9ae6b4;
      }
      .error { 
        background: linear-gradient(135deg, #fed7d7, #feb2b2);
        color: #742a2a;
        border: 1px solid #feb2b2;
      }
      .loading {
        opacity: 0.7;
        pointer-events: none;
      }
      .spinner {
        display: inline-block;
        width: 16px;
        height: 16px;
        border: 2px solid #ffffff40;
        border-radius: 50%;
        border-top-color: #ffffff;
        animation: spin 1s ease-in-out infinite;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      .canva-badge {
        margin-top: 20px;
        padding: 10px;
        background: #f0f8ff;
        border-radius: 8px;
        font-size: 14px;
        color: #4a5568;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>🎨 Social Media Image Preview</h1>
        <p class="subtitle">Generated with Canva API</p>
        <div class="platform-badge">${platform}</div>
      </div>
      
      <div class="image-container">
        <img src="data:image/png;base64,${base64Image}" alt="Social Media Preview" class="image" id="preview-image">
      </div>
      
      <div class="actions">
        <button class="button save" id="save-button">
          💾 Save to Airtable
        </button>
        <button class="button cancel" onclick="window.close()">
          ✕ Cancel
        </button>
      </div>
      
      <div id="message" class="message"></div>
      
      <div class="canva-badge">
        ✨ Powered by Canva API - Professional design templates with gradients and effects
      </div>
    </div>
    
    <script>
      const RECORD_ID = "${recordId}";
      const TITLE = "${escapedTitle}";
      const OVERLINE = "${escapedOverline}";
      const IMG_URL = "${escapedImgUrl}";
      const PLATFORM = "${platform}";
      const IMAGE_PATH = "${imagePath.replace(/\\/g, '\\\\')}";
      
      document.getElementById('save-button').addEventListener('click', async function() {
        try {
          const button = this;
          const message = document.getElementById('message');
          
          // Show loading state
          button.innerHTML = '<span class="spinner"></span> Saving...';
          button.disabled = true;
          button.classList.add('loading');
          
          const response = await fetch('/api/social-media-images/save-to-airtable', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recordId: RECORD_ID,
              imagePath: IMAGE_PATH,
              platform: PLATFORM
            })
          });
          
          const data = await response.json();
          
          if (data.success) {
            message.className = 'message success';
            message.textContent = '✅ Image saved successfully to Airtable!';
            message.style.display = 'block';
            
            button.innerHTML = '✅ Saved!';
            
            setTimeout(() => window.close(), 2000);
          } else {
            throw new Error(data.error);
          }
        } catch (error) {
          const message = document.getElementById('message');
          message.className = 'message error';
          message.textContent = '❌ Error: ' + (error.message || 'Failed to save');
          message.style.display = 'block';
          
          const button = document.getElementById('save-button');
          button.innerHTML = '🔄 Try Again';
          button.disabled = false;
          button.classList.remove('loading');
        }
      });
    </script>
  </body>
</html>`

    res.send(htmlContent)
  } catch (error) {
    logger.error('Error in airtable-generate endpoint:', error)
    res.status(500).send(`
      <html>
        <head><title>Error</title></head>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1 style="color: #e53e3e;">⚠️ Generation Error</h1>
          <p style="color: #4a5568; font-size: 16px;">${
            error.message || 'An unknown error occurred'
          }</p>
          <p style="color: #718096; font-size: 14px;">Please check your Canva API configuration and try again.</p>
        </body>
      </html>
    `)
  }
})

/**
 * API endpoint to save image to Airtable
 * POST /api/social-media-images/save-to-airtable
 */
router.post('/save-to-airtable', async (req, res) => {
  try {
    const { recordId, imagePath, platform } = req.body

    if (!recordId || !imagePath || !platform) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters',
      })
    }

    // Upload to Airtable
    const imageUrl = await uploadToAirtable(imagePath, recordId, platform)

    // Delete temp file
    try {
      fs.unlinkSync(imagePath)
    } catch (e) {
      logger.warn('Failed to delete temp file:', e)
    }

    return res.json({
      success: true,
      data: { imageUrl },
    })
  } catch (error) {
    logger.error('Error in save-to-airtable endpoint:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to save to Airtable',
    })
  }
})

/**
 * Generate images for all platforms
 * POST /api/social-media-images/generate-all-platforms
 */
router.post('/generate-all-platforms', async (req, res) => {
  try {
    const { recordId, title, overline = '', imgUrl = null } = req.body

    if (!recordId || !title) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: recordId and title',
      })
    }

    const platforms = ['facebook', 'twitter', 'instagram']
    const results = {}

    // Generate images for all platforms in parallel
    const promises = platforms.map(async (platform) => {
      try {
        const imagePath = await generateWithCanva({
          title,
          overline,
          backgroundUrl: imgUrl,
          platform,
        })

        const imageUrl = await uploadToAirtable(imagePath, recordId, platform)

        // Cleanup
        try {
          fs.unlinkSync(imagePath)
        } catch (e) {
          logger.warn(`Failed to delete temp file for ${platform}:`, e)
        }

        return { platform, success: true, url: imageUrl }
      } catch (error) {
        logger.error(`Error generating ${platform} image:`, error)
        return { platform, success: false, error: error.message }
      }
    })

    const platformResults = await Promise.all(promises)

    // Format results
    platformResults.forEach((result) => {
      results[result.platform] = {
        success: result.success,
        url: result.url || null,
        error: result.error || null,
      }
    })

    return res.json({
      success: true,
      message: 'Bulk generation complete',
      results,
    })
  } catch (error) {
    logger.error('Error in generate-all-platforms endpoint:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate images',
    })
  }
})

export default router
