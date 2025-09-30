import { uploadImagesOnPublish } from './publishImageUploader.js'
import logger from '../utils/logger.js'
import axios from 'axios'
import config from '../config/index.js'

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

    // 1. Check current record status and imgUrl
    const response = await axios.get(`${airtableApiUrl}/${recordId}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    })

    const fields = response.data.fields

    // Only proceed if status is 'published' and imgUrl contains Airtable URL
    if (
      fields.status !== 'published' ||
      !fields.imgUrl ||
      !fields.imgUrl.includes('airtableusercontent.com')
    ) {
      logger.info(`Record ${recordId} doesn't need processing`)
      return false
    }

    // 2. Upload images to Cloudinary (this function only returns URLs)
    const cloudinaryFields = await uploadImagesOnPublish(
      recordId,
      sectionId,
      tableName
    )

    if (!cloudinaryFields || !cloudinaryFields.imgUrl) {
      logger.info(`No images uploaded for record ${recordId}`)
      return false
    }

    // 3. Update Airtable record with Cloudinary URLs (but keep status as 'published')
    const updateData = {
      imgUrl: cloudinaryFields.imgUrl,
      'article-images': cloudinaryFields['article-images'],
      // DON'T update status - it's already 'published'
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
    return true
  } catch (error) {
    logger.error(`❌ Error processing status change:`, error.message)
    throw error
  }
}
