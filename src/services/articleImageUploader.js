import { v2 as cloudinary } from 'cloudinary'
import axios from 'axios'
import logger from '../utils/logger.js'

// Configure Cloudinary (reuse existing config)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
})

/**
 * Upload article images to Cloudinary with organized folder structure
 * @param {Array} airtableUrls - Array of Airtable image URLs
 * @param {String} recordId - Airtable record ID
 * @param {String} sectionId - Section ID for folder organization
 * @returns {Array} - Array of Cloudinary URLs
 */
export async function uploadArticleImagesToCloudinary(
  airtableUrls,
  recordId,
  sectionId
) {
  if (
    !airtableUrls ||
    !Array.isArray(airtableUrls) ||
    airtableUrls.length === 0
  ) {
    logger.info('No images to upload to Cloudinary')
    return []
  }

  logger.info(
    `📤 Starting Cloudinary upload for ${airtableUrls.length} article images...`
  )
  const cloudinaryUrls = []

  for (let i = 0; i < airtableUrls.length; i++) {
    const url = airtableUrls[i]
    try {
      logger.info(
        `📤 Uploading article image ${i + 1}/${
          airtableUrls.length
        } to Cloudinary...`
      )

      // Create folder structure: rdv-articles/{sectionId}/{year-month}
      const currentDate = new Date()
      const yearMonth = `${currentDate.getFullYear()}-${String(
        currentDate.getMonth() + 1
      ).padStart(2, '0')}`
      const folderPath = `rdv-articles/${sectionId}/${yearMonth}`

      // Generate unique public_id with timestamp
      const timestamp = Date.now()
      const publicId = `${recordId}-${i}-${timestamp}`

      // ✅ UPLOAD WITH MAXIMUM QUALITY - NO TRANSFORMATIONS
      const uploadResult = await cloudinary.uploader.upload(url, {
        folder: folderPath,
        public_id: publicId,
        resource_type: 'auto',
        quality: 100, // ✅ Maximum quality on upload
        use_filename: true,
        unique_filename: true,
        overwrite: true,
        invalidate: true, // ✅ Clear CDN cache
        // ✅ NO TRANSFORMATION at upload time
        transformation: [],
        tags: [sectionId, 'rdv-news', yearMonth, 'article-image'],
      })

      cloudinaryUrls.push(uploadResult.secure_url)
      logger.info(
        `✅ Uploaded article image to Cloudinary: ${uploadResult.secure_url}`
      )
    } catch (error) {
      logger.error(`❌ Cloudinary upload failed for ${url}:`, error.message)
      cloudinaryUrls.push(url) // Fallback to original URL
    }
  }

  logger.info(
    `✅ Cloudinary article images upload completed: ${cloudinaryUrls.length} images processed`
  )
  return cloudinaryUrls
}

export default {
  uploadArticleImagesToCloudinary,
}
