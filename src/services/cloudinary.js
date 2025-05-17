import { v2 as cloudinary } from 'cloudinary';
import logger from '../utils/logger.js';

// Configure Cloudinary with environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Upload image buffer to Cloudinary
 * @param {Buffer} imageBuffer - The image buffer to upload
 * @param {string} fileName - Name for the file (will be used as public_id)
 * @param {object} options - Additional options for upload
 * @returns {Promise<string>} Public URL of the uploaded image
 */
export async function uploadImage(imageBuffer, fileName, options = {}) {
  try {
    // Convert filename to a Cloudinary-friendly public_id (no extension, no special chars)
    const publicId = fileName.split('.')[0].replace(/[^a-zA-Z0-9]/g, '_');
    
    // Prepare upload options
    const uploadOptions = {
      folder: 'rdv-news/social-media',
      public_id: publicId,
      overwrite: true,
      resource_type: 'image',
      ...options
    };
    
    // Convert buffer to Base64 string for upload
    const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
    
    // Upload to Cloudinary
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload(
        base64Image,
        uploadOptions,
        (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        }
      );
    });
    
    logger.info(`Image uploaded to Cloudinary: ${result.public_id}`);
    
    // Return the secure URL
    return result.secure_url;
  } catch (error) {
    logger.error('Error uploading to Cloudinary:', error);
    throw new Error(`Failed to upload image: ${error.message}`);
  }
}

export default {
  uploadImage
};