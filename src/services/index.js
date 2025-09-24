import { uploadArticleImagesToCloudinary} from './articleImageUploader.js'
import {
  uploadImagesOnPublish,
  publishArticleWithImages,
} from './publishImageUploader.js'
import airtableService from './airtable.js'

import * as embeds from './embeds/index.js'

export { airtableService, embeds, uploadArticleImagesToCloudinary }

// Export new publishing service
export const publishService = {
  uploadImagesOnPublish,
  publishArticleWithImages
}
