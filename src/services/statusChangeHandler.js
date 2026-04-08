import { uploadImagesOnPublish } from './publishImageUploader.js'
import logger from '../utils/logger.js'
import axios from 'axios'
import config from '../config/index.js'

/**
 * Generate an SEO slug from the article title + current date.
 * Example: "Coronel Suárez lanza nuevo plan de obras" → "coronel-suarez-lanza-nuevo-plan-de-obras-2026-04-08"
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

  // Append current date YYYY-MM-DD
  const now = new Date()
  const dateSuffix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

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
      tableName,
    )

    if (!cloudinaryFields || !cloudinaryFields.imgUrl) {
      logger.info(`No images uploaded for record ${recordId}`)
      return false
    }

    // 3. Generate SEO slug from the current title + date
    const seoSlug = generateSeoSlug(fields.title)
    logger.info(`📝 Generated SEO slug: ${seoSlug}`)

    // 4. Update Airtable record with Cloudinary URLs + SEO slug (keep status as 'published')
    const updateData = {
      imgUrl: cloudinaryFields.imgUrl,
      'article-images': cloudinaryFields['article-images'],
      url: seoSlug,
    }

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
