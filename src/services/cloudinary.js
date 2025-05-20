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
 * Upload image buffer or file path to Cloudinary
 * @param {Buffer|string} source - The image buffer or file path to upload
 * @param {string} fileName - Name for the file (will be used as public_id)
 * @param {object} options - Additional options for upload
 * @returns {Promise<string>} Public URL of the uploaded image
 */
export async function uploadImage(source, fileName, options = {}) {
  try {
    // Check if we're using a file path or buffer
    const useFilePath = options.useFilePath || false;
    let tempFilePath;
    
    if (useFilePath) {
      // Use the provided file path directly
      tempFilePath = source;
    } else {
      // Create a temporary file from buffer
      tempFilePath = path.join(os.tmpdir(), fileName);
      fs.writeFileSync(tempFilePath, source);
    }
    
    // Add timestamp to ensure unique filename
    const timestamp = new Date().getTime();
    const publicId = `social-media/${timestamp}-${fileName.split('.')[0]}`;
    
    // Update the upload options
    const uploadOptions = {
      public_id: publicId,
      resource_type: 'image',
      use_filename: true,
      unique_filename: true,
      overwrite: true,
      quality: 100,
      format: 'png',
      // Don't use any transformations
      transformation: []
    };
    
    const result = await cloudinary.uploader.upload(tempFilePath, uploadOptions);
    
    // Delete the temporary file only if we created it
    if (!useFilePath) {
      fs.unlinkSync(tempFilePath);
    }
    
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