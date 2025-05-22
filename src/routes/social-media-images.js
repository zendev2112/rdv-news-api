import express from 'express'
import Airtable from 'airtable'
import logger from '../utils/logger.js'
import config from '../config/index.js'
import { uploadImage } from '../services/cloudinary.js'
import fs from 'fs'
import {
  initialize,
  renderSocialImage,
  close,
} from '../services/browser-renderer.js'

// Initialize Puppeteer on startup
initialize().catch((err) => {
  logger.error('Failed to initialize browser renderer:', err)
})

// Handle cleanup on process exit
process.on('SIGINT', async () => {
  await close()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await close()
  process.exit(0)
})

/**
 * Generate social media image using Puppeteer
 * @param {string} imageUrl - URL to source image
 * @param {string} text - Title text
 * @param {string} dateStr - Date text
 * @param {Object} options - Options including dimensions
 * @returns {Promise<string>} - Path to generated image
 */
async function generateImageWithPuppeteer(
  imageUrl,
  text,
  dateStr,
  options = {}
) {
  try {
    const { width = 1200, height = 628, platform = 'facebook' } = options

    // Generate the image with Puppeteer
    const outputPath = await renderSocialImage({
      imageUrl,
      title: text,
      date: dateStr,
      width,
      height,
      platform,
    })

    logger.info(`Generated image with Puppeteer at: ${outputPath}`)
    return outputPath
  } catch (error) {
    logger.error(`Error generating image with Puppeteer: ${error.message}`)
    throw new Error(`Image generation failed: ${error.message}`)
  }
}

/**
 * Create an image with text using Puppeteer for perfect text rendering
 * @param {string} imageUrl - URL to base image
 * @param {string} title - Title text
 * @param {string} dateStr - Date text
 * @param {Object} options - Image options
 * @returns {Promise<string>} - Path to the generated image file
 */
async function generateSocialMediaImageFile(
  imageUrl,
  title,
  dateStr,
  options = {}
) {
  try {
    const { platform = 'facebook' } = options

    // Set dimensions based on platform
    let width, height
    switch (platform.toLowerCase()) {
      case 'instagram':
        width = 800
        height = 800 // Square format
        break
      case 'twitter':
        width = 1200
        height = 675 // 16:9 ratio
        break
      case 'facebook':
      default:
        width = 1200
        height = 628 // Recommended for sharing
    }

    // Use Puppeteer-based renderer for perfect text rendering
    const imagePath = await generateImageWithPuppeteer(
      imageUrl,
      title,
      dateStr,
      { width, height, platform }
    )

    return imagePath
  } catch (error) {
    logger.error('Error generating social media image file:', error)
    throw error
  }
}

const router = express.Router()

// Root endpoint
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Social media images API is working',
    endpoints: {
      generate: '/api/social-media-images/generate',
      generateAll: '/api/social-media-images/generate-all',
    },
  })
})

/**
 * Generate social media image for a specific record
 * POST /api/social-media-images/generate
 */
router.post('/generate', async (req, res) => {
  try {
    const { recordId, platform = 'facebook', imageUrl, title } = req.body

    logger.info(
      `Received request to generate ${platform} image for record ${recordId}`
    )

    if (!recordId || !imageUrl || !title) {
      return res.status(400).json({
        success: false,
        error: 'Record ID, image URL, and title are required',
      })
    }

    // Test the image URL by trying to fetch headers
    try {
      const imageResponse = await fetch(imageUrl, { method: 'HEAD' })
      if (!imageResponse.ok) {
        return res.status(400).json({
          success: false,
          error: `Image URL returned status ${imageResponse.status}`,
        })
      }
    } catch (imageError) {
      return res.status(400).json({
        success: false,
        error: `Could not access image URL: ${imageError.message}`,
      })
    }

    // Get Airtable credentials
    const apiToken =
      config.airtable?.personalAccessToken || process.env.AIRTABLE_TOKEN
    const baseId = config.airtable?.baseId || process.env.AIRTABLE_BASE_ID

    if (!apiToken || !baseId) {
      logger.error('Missing Airtable credentials')
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: Missing Airtable credentials',
      })
    }

    // Format the date string
    const dateStr = new Date().toLocaleDateString('es-ES', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })

    // Generate the image file
    const imagePath = await generateSocialMediaImageFile(
      imageUrl,
      title,
      dateStr,
      { platform: platform.toLowerCase() }
    )

    // Create timestamp for filename
    const timestamp = new Date().toISOString().substring(0, 10)
    const fileName = `${platform.toLowerCase()}-${recordId}-${timestamp}.png`

    // Upload the file to Cloudinary
    const publicUrl = await uploadImage(imagePath, fileName, {
      format: 'png',
      quality: 100,
      useFilePath: true,
    })

    // Clean up temporary file
    try {
      fs.unlinkSync(imagePath)
    } catch (cleanupError) {
      logger.warn(`Could not delete temporary image: ${cleanupError.message}`)
    }

    // Initialize Airtable
    const airtable = new Airtable({ apiKey: apiToken })
    const base = airtable.base(baseId)

    // Create update object with the Cloudinary URL
    const updateFields = {}
    if (platform.toLowerCase() === 'instagram') {
      updateFields.social_image_instagram = [
        {
          filename: fileName,
          url: publicUrl,
        },
      ]
    } else if (platform.toLowerCase() === 'twitter') {
      updateFields.social_image_twitter = [
        {
          filename: fileName,
          url: publicUrl,
        },
      ]
    } else {
      updateFields.social_image_facebook = [
        {
          filename: fileName,
          url: publicUrl,
        },
      ]
    }

    // Update Airtable record
    await base('Redes Sociales').update(recordId, updateFields)

    // Generate a small preview image for response
    const previewPath = await renderSocialImage({
      imageUrl,
      title: title,
      date: dateStr,
      width: 600,
      height: platform.toLowerCase() === 'instagram' ? 600 : 315,
      platform: `preview-${platform}`,
    })

    // Read the preview file and convert to data URL
    const previewBuffer = fs.readFileSync(previewPath)
    const previewDataUrl = `data:image/png;base64,${previewBuffer.toString(
      'base64'
    )}`

    // Clean up preview file
    try {
      fs.unlinkSync(previewPath)
    } catch (error) {
      logger.warn(`Could not delete preview image: ${error.message}`)
    }

    return res.json({
      success: true,
      message: `Generated and uploaded image for ${platform}`,
      data: {
        recordId,
        platform,
        title: title,
        previewWithTitle: previewDataUrl,
        imageUrl: publicUrl,
      },
    })
  } catch (error) {
    logger.error('Error generating social media image:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate social media image',
    })
  }
})

/**
 * Generate social media images for multiple platforms
 * POST /api/social-media-images/generate-all
 */
router.post('/generate-all', async (req, res) => {
  try {
    const { recordId, imageUrl, title } = req.body
    const platforms = ['facebook', 'twitter', 'instagram']

    if (!recordId || !imageUrl || !title) {
      return res.status(400).json({
        success: false,
        error: 'Record ID, image URL, and title are required',
      })
    }

    // Test the image URL by trying to fetch headers
    try {
      const imageResponse = await fetch(imageUrl, { method: 'HEAD' })
      if (!imageResponse.ok) {
        return res.status(400).json({
          success: false,
          error: `Image URL returned status ${imageResponse.status}`,
        })
      }
    } catch (imageError) {
      return res.status(400).json({
        success: false,
        error: `Could not access image URL: ${imageError.message}`,
      })
    }

    // Get Airtable credentials
    const apiToken =
      config.airtable?.personalAccessToken || process.env.AIRTABLE_TOKEN
    const baseId = config.airtable?.baseId || process.env.AIRTABLE_BASE_ID

    if (!apiToken || !baseId) {
      logger.error('Missing Airtable credentials')
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: Missing Airtable credentials',
      })
    }

    // Format the date string
    const dateStr = new Date().toLocaleDateString('es-ES', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })

    // Initialize Airtable
    const airtable = new Airtable({ apiKey: apiToken })
    const base = airtable.base(baseId)

    // Create timestamp for filenames
    const timestamp = new Date().toISOString().substring(0, 10)

    // Generate images for all platforms and upload to Cloudinary
    const results = []
    const updateFields = {}

    // Generate a preview for the response
    const previewPath = await renderSocialImage({
      imageUrl,
      title: title,
      date: dateStr,
      width: 600,
      height: 315,
      platform: 'preview',
    })

    // Read the preview file and convert to data URL
    const previewBuffer = fs.readFileSync(previewPath)
    const previewDataUrl = `data:image/png;base64,${previewBuffer.toString(
      'base64'
    )}`

    // Clean up preview file
    try {
      fs.unlinkSync(previewPath)
    } catch (error) {
      logger.warn(`Could not delete preview image: ${error.message}`)
    }

    // Process each platform
    for (const platform of platforms) {
      try {
        // Set dimensions based on platform
        let width, height
        if (platform === 'instagram') {
          width = 800
          height = 800
        } else if (platform === 'twitter') {
          width = 1200
          height = 675
        } else {
          width = 1200
          height = 628
        }

        // Generate the image
        const imagePath = await generateSocialMediaImageFile(
          imageUrl,
          title,
          dateStr,
          { platform, width, height }
        )

        // Create filename and upload to Cloudinary
        const fileName = `${platform}-${recordId}-${timestamp}.png`
        const publicUrl = await uploadImage(imagePath, fileName, {
          format: 'png',
          quality: 100,
          useFilePath: true,
        })

        // Clean up temporary file
        try {
          fs.unlinkSync(imagePath)
        } catch (cleanupError) {
          logger.warn(
            `Could not delete temporary image for ${platform}: ${cleanupError.message}`
          )
        }

        // Add to results and update fields
        results.push({
          platform,
          success: true,
          title: title,
          imageUrl: publicUrl,
        })

        // Set update field based on platform
        if (platform === 'instagram') {
          updateFields.social_image_instagram = [
            {
              filename: fileName,
              url: publicUrl,
            },
          ]
        } else if (platform === 'twitter') {
          updateFields.social_image_twitter = [
            {
              filename: fileName,
              url: publicUrl,
            },
          ]
        } else {
          updateFields.social_image_facebook = [
            {
              filename: fileName,
              url: publicUrl,
            },
          ]
        }
      } catch (platformError) {
        logger.error(`Error generating image for ${platform}:`, platformError)
        results.push({
          platform,
          success: false,
          error: platformError.message,
          title: title,
        })
      }
    }

    // Update Airtable record with all images
    if (Object.keys(updateFields).length > 0) {
      await base('Redes Sociales').update(recordId, updateFields)
    }

    // Return results
    return res.json({
      success: true,
      message: 'Generated and uploaded social media images',
      data: {
        recordId,
        results,
        previewWithTitle: previewDataUrl,
      },
    })
  } catch (error) {
    logger.error('Error in generate-all endpoint:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to process request',
    })
  }
})

export default router
