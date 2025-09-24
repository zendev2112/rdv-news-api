import { uploadArticleImagesToCloudinary } from './articleImageUploader.js'
import logger from '../utils/logger.js'
import axios from 'axios'
import config from '../config/index.js'

/**
 * Handle status change from 'draft' to 'published' - upload images to Cloudinary
 * @param {string} recordId - Airtable record ID
 * @param {string} tableName - Airtable table name
 * @param {string} sectionId - Section ID for Cloudinary folders
 */
export async function handlePublishStatusChange(
  recordId,
  tableName,
  sectionId
) {
  try {
    logger.info(`🔍 Processing status change for record ${recordId}`)

    const baseId = config.airtable?.baseId || process.env.AIRTABLE_BASE_ID
    const apiToken =
      config.airtable?.personalAccessToken || process.env.AIRTABLE_TOKEN
    const airtableApiUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
      tableName
    )}`

    // Get current record
    const response = await axios.get(`${airtableApiUrl}/${recordId}`, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    })

    const fields = response.data.fields

    // Check if it's published and has Airtable URLs (needs Cloudinary upload)
    const isPublished = fields.status === 'published'
    const hasAirtableUrl =
      fields.imgUrl && fields.imgUrl.includes('airtableusercontent.com')

    if (!isPublished) {
      logger.info(`ℹ️ Record ${recordId} is not published - no action needed`)
      return false
    }

    if (!hasAirtableUrl) {
      logger.info(
        `ℹ️ Record ${recordId} already has Cloudinary URLs - no action needed`
      )
      return false
    }

    logger.info(
      `🚀 Record ${recordId} published with Airtable URLs - uploading to Cloudinary...`
    )

    // Extract Airtable URLs from image field
    let airtableUrls = []
    if (
      fields.image &&
      Array.isArray(fields.image) &&
      fields.image.length > 0
    ) {
      airtableUrls = fields.image
        .filter((img) => img.url && img.url.includes('airtableusercontent.com'))
        .map((img) => img.url)
    }

    if (airtableUrls.length === 0) {
      logger.error(
        `❌ No Airtable URLs found in image field for record ${recordId}`
      )
      return false
    }

    // Upload to Cloudinary
    const cloudinaryUrls = await uploadArticleImagesToCloudinary(
      airtableUrls,
      recordId,
      sectionId
    )

    if (cloudinaryUrls.length > 0) {
      // Update record with Cloudinary URLs
      const updateData = {
        imgUrl: cloudinaryUrls[0], // Main Cloudinary URL
        'article-images': cloudinaryUrls.slice(1).join(', '), // Additional Cloudinary URLs
      }

      await axios.patch(
        `${airtableApiUrl}/${recordId}`,
        { fields: updateData },
        {
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
        }
      )

      logger.info(`✅ Updated record ${recordId} with Cloudinary URLs`)
      logger.info(`📝 Main image: ${cloudinaryUrls[0]}`)
      if (cloudinaryUrls.length > 1) {
        logger.info(
          `📝 Additional images: ${cloudinaryUrls.slice(1).join(', ')}`
        )
      }

      return true
    } else {
      logger.error(`❌ No Cloudinary URLs returned for record ${recordId}`)
      return false
    }
  } catch (error) {
    logger.error(
      `❌ Error handling status change for ${recordId}:`,
      error.message
    )
    throw error
  }
}

export default {
  handlePublishStatusChange,
}
