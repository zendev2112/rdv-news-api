import { uploadImagesOnPublish } from './publishImageUploader.js'
import logger from '../utils/logger.js'
import axios from 'axios'
import config from '../config/index.js'

/**
 * Generate an SEO slug from the article title + current date.
 * Example: "Coronel Suárez lanza nuevo plan de obras" → "coronel-suarez-lanza-nuevo-plan-de-obras-08-04-2026"
 */
function generateSeoSlug(title) {
  if (!title || typeof title !== 'string') {
    return `articulo-${Date.now()}`
  }

  // Remove accents
  const normalized = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  // Slugify
  let slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  // Limit to 80 chars preserving whole words
  if (slug.length > 80) {
    const cut = slug.substring(0, 80).lastIndexOf('-')
    slug = slug.substring(0, cut > 40 ? cut : 80)
  }

  // Append current date DD-MM-YYYY (Latam format)
  const now = new Date()
  const dateSuffix = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`

  return `${slug || 'articulo'}-${dateSuffix}`
}

export async function handlePublishStatusChange(
  recordId,
  tableName,
  sectionId,
) {
  try {
    logger.info(`🔍 Processing status change for record ${recordId}`)

    const baseId = config.airtable?.baseId || process.env.AIRTABLE_BASE_ID
    const apiToken =
      config.airtable?.personalAccessToken || process.env.AIRTABLE_TOKEN
    const airtableApiUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
      tableName,
    )}`

    // 1. Check current record status and imgUrl
    const response = await axios.get(`${airtableApiUrl}/${recordId}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    })

    const fields = response.data.fields

    // Only proceed if status is 'published'
    if (fields.status !== 'published') {
      logger.info(`Record ${recordId} status is '${fields.status}', skipping`)
      return false
    }

    // 2. Generate SEO slug from the current title + date (always)
    const seoSlug = generateSeoSlug(fields.title)
    logger.info(`📝 Generated SEO slug: ${seoSlug}`)

    const updateData = { url: seoSlug }

    // 3. Upload images to Cloudinary if imgUrl exists and is not already a Cloudinary URL
    const imgUrl = fields.imgUrl || ''
    const isAlreadyCloudinary =
      imgUrl.includes('cloudinary.com') || imgUrl.includes('res.cloudinary')

    if (imgUrl && !isAlreadyCloudinary) {
      const cloudinaryFields = await uploadImagesOnPublish(
        recordId,
        sectionId,
        tableName,
      )

      if (cloudinaryFields && cloudinaryFields.imgUrl) {
        updateData.imgUrl = cloudinaryFields.imgUrl
        if (cloudinaryFields['article-images']) {
          updateData['article-images'] = cloudinaryFields['article-images']
        }
      }
    } else if (!imgUrl) {
      logger.info(`No images to upload for record ${recordId}`)
    } else {
      logger.info(`Images already on Cloudinary for record ${recordId}`)
    }

    // 4. Update Airtable record with Cloudinary URLs + SEO slug

    await axios.patch(
      `${airtableApiUrl}/${recordId}`,
      { fields: updateData },
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
      },
    )

    logger.info(`✅ Updated record ${recordId} with Cloudinary URLs`)
    return true
  } catch (error) {
    logger.error(`❌ Error processing status change:`, error.message)
    throw error
  }
}
