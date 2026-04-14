import { uploadArticleImagesToCloudinary } from './articleImageUploader.js'
import logger from '../utils/logger.js'
import axios from 'axios'
import config from '../config/index.js'

/**
 * Upload article images to Cloudinary when article is published
 * @param {string} recordId - Airtable record ID
 * @param {string} sectionId - Section ID
 * @param {string} tableName - Airtable table name
 * @returns {Object} - Updated imgUrl and article-images URLs
 */
export async function uploadImagesOnPublish(recordId, sectionId, tableName) {
  try {
    logger.info(
      `🚀 Publishing article ${recordId} - uploading images to Cloudinary...`,
    )

    // Get Airtable API URL
    const baseId = config.airtable?.baseId || process.env.AIRTABLE_BASE_ID
    const apiToken =
      config.airtable?.personalAccessToken || process.env.AIRTABLE_TOKEN
    const airtableApiUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
      tableName,
    )}`

    // Fetch current record to get Airtable image URLs
    const response = await axios.get(`${airtableApiUrl}/${recordId}`, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    })

    const fields = response.data.fields

    // Extract current Airtable URLs from image field
    let imageUrls = []
    if (
      fields.image &&
      Array.isArray(fields.image) &&
      fields.image.length > 0
    ) {
      imageUrls = fields.image
        .filter(
          (img) =>
            img.url &&
            !img.url.includes('cloudinary.com') &&
            !img.url.includes('res.cloudinary'),
        )
        .map((img) => img.url)
    }

    // Also check imgUrl field as fallback (pipeline stores source URL there)
    if (imageUrls.length === 0 && fields.imgUrl) {
      const imgUrl = fields.imgUrl
      if (
        imgUrl.startsWith('http') &&
        !imgUrl.includes('cloudinary.com') &&
        !imgUrl.includes('res.cloudinary')
      ) {
        imageUrls = [imgUrl]
      }
    }

    if (imageUrls.length === 0) {
      logger.info(`No images to upload for record ${recordId}`)
      return { imgUrl: '', 'article-images': '' }
    }

    logger.info(
      `📤 Uploading ${imageUrls.length} images to Cloudinary for published article...`,
    )

    // Upload to Cloudinary
    const cloudinaryUrls = await uploadArticleImagesToCloudinary(
      imageUrls,
      recordId,
      sectionId,
    )

    if (cloudinaryUrls.length > 0) {
      const updatedFields = {
        imgUrl: cloudinaryUrls[0], // Main Cloudinary URL
        'article-images': cloudinaryUrls.slice(1).join(', '), // Additional Cloudinary URLs
      }

      logger.info(
        `✅ Uploaded ${cloudinaryUrls.length} images to Cloudinary for record ${recordId}`,
      )
      logger.info(`📝 Main image: ${cloudinaryUrls[0]}`)
      if (cloudinaryUrls.length > 1) {
        logger.info(
          `📝 Additional images: ${cloudinaryUrls.slice(1).join(', ')}`,
        )
      }

      return updatedFields
    } else {
      logger.error(`❌ No Cloudinary URLs returned for record ${recordId}`)
      return null
    }
  } catch (error) {
    logger.error(
      `❌ Error uploading images on publish for ${recordId}:`,
      error.message,
    )
    throw error
  }
}

/**
 * Update article status to published and upload images to Cloudinary
 * @param {string} recordId - Airtable record ID
 * @param {string} sectionId - Section ID
 * @param {string} tableName - Airtable table name
 * @param {Object} additionalFields - Additional fields to update
 * @returns {Object} - Updated record
 */
export async function publishArticleWithImages(
  recordId,
  sectionId,
  tableName,
  additionalFields = {},
) {
  try {
    logger.info(
      `🚀 Publishing article ${recordId} with Cloudinary image upload...`,
    )

    // Upload images to Cloudinary
    const cloudinaryFields = await uploadImagesOnPublish(
      recordId,
      sectionId,
      tableName,
    )

    if (!cloudinaryFields) {
      throw new Error('Failed to upload images to Cloudinary')
    }

    // Prepare update data
    const updateData = {
      status: 'published',
      ...cloudinaryFields, // Add Cloudinary URLs
      ...additionalFields, // Add any other fields (front, order, etc.)
    }

    // Update the record
    const baseId = config.airtable?.baseId || process.env.AIRTABLE_BASE_ID
    const apiToken =
      config.airtable?.personalAccessToken || process.env.AIRTABLE_TOKEN
    const airtableApiUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
      tableName,
    )}`

    const response = await axios.patch(
      `${airtableApiUrl}/${recordId}`,
      { fields: updateData },
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
      },
    )

    logger.info(
      `✅ Successfully published article ${recordId} with Cloudinary images`,
    )
    return response.data
  } catch (error) {
    logger.error(`❌ Error publishing article with images:`, error.message)
    throw error
  }
}

export default {
  uploadImagesOnPublish,
  publishArticleWithImages,
}
