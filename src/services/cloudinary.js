import { v2 as cloudinary } from 'cloudinary';
import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Configure Cloudinary with environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Upload image buffer to Cloudinary
 * @param {Buffer} buffer - The image buffer to upload
 * @param {string} fileName - Name for the file (will be used as public_id)
 * @param {object} options - Additional options for upload
 * @returns {Promise<string>} Public URL of the uploaded image
 */
export async function uploadImage(buffer, fileName, options = {}) {
  try {
    // Create a temporary file to upload
    const tempFilePath = path.join(os.tmpdir(), fileName);
    fs.writeFileSync(tempFilePath, buffer);
    
    // Add timestamp to ensure unique filename
    const timestamp = new Date().getTime();
    const publicId = `social-media/${timestamp}-${fileName.split('.')[0]}`;
    
    // Use these options to prevent any transformation
    const uploadOptions = {
      public_id: publicId,
      resource_type: 'image',
      use_filename: true,
      unique_filename: true,
      overwrite: true,
      // Instead of using transformation array, use direct options
      quality: 100,
      format: 'png', 
      // No additional transformations to preserve the original image exactly
      transformation: [
        {quality: 100}
      ]
    };
    
    const result = await cloudinary.uploader.upload(tempFilePath, uploadOptions);
    
    // Delete the temporary file
    fs.unlinkSync(tempFilePath);
    
    // Return the secure URL
    return result.secure_url;
  } catch (error) {
    logger.error('Error uploading to Cloudinary:', error);
    throw error;
  }
}

export default {
  uploadImage
};