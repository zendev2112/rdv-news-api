import { createCanvas, loadImage } from 'canvas';
import logger from '../utils/logger.js';

/**
 * Generate a social media image with title overlay
 * @param {Object} data - The data needed to generate the image
 * @param {string} data.imageUrl - URL of the base image
 * @param {string} data.title - Title to overlay on the image
 * @param {string} data.platform - Target platform (instagram, twitter, facebook)
 * @returns {Promise<Buffer>} - Buffer containing the generated image
 */
export async function generateSocialMediaImage(data) {
  const { imageUrl, title, platform = 'generic' } = data;
  
  if (!imageUrl) {
    throw new Error('Image URL is required');
  }
  
  try {
    // Define dimensions based on platform
    let width, height;
    switch (platform.toLowerCase()) {
      case 'instagram':
        width = 1080;
        height = 1080; // Square format
        break;
      case 'twitter':
      case 'x':
        width = 1200;
        height = 675; // 16:9 ratio
        break;
      case 'facebook':
        width = 1200;
        height = 630; // Recommended for sharing
        break;
      default:
        width = 1200;
        height = 630; // Default format
    }
    
    logger.info(`Creating canvas for ${platform} with dimensions ${width}x${height}`);
    
    // Create canvas with the specified dimensions
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Basic background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    
    logger.info(`Loading image from URL: ${imageUrl}`);
    
    // Load the source image
    const image = await loadImage(imageUrl);
    logger.info(`Image loaded successfully, dimensions: ${image.width}x${image.height}`);
    
    // Calculate aspect ratios to ensure proper fit
    const imageAspect = image.width / image.height;
    const canvasAspect = width / height;
    
    // Draw the image
    if (imageAspect > canvasAspect) {
      // Image is wider than canvas (crop sides)
      const newWidth = image.height * canvasAspect;
      const sx = (image.width - newWidth) / 2;
      ctx.drawImage(image, sx, 0, newWidth, image.height, 0, 0, width, height);
    } else {
      // Image is taller than canvas (crop top/bottom)
      const newHeight = image.width / canvasAspect;
      const sy = (image.height - newHeight) / 3; // Crop more from bottom than top
      ctx.drawImage(image, 0, sy, image.width, newHeight, 0, 0, width, height);
    }
    
    // Add a semi-transparent overlay for better text visibility
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, width, height);
    
    // Add the title text (simplified)
    const formattedTitle = title.length > 100 ? title.substring(0, 97) + '...' : title;
    
    ctx.font = `bold ${Math.floor(width * 0.05)}px Arial, sans-serif`;
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Simple text wrapping
    const words = formattedTitle.split(' ');
    const lines = [];
    let currentLine = words[0];
    
    const maxLineWidth = width * 0.8; // 80% of canvas width
    
    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const testLine = currentLine + ' ' + word;
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width > maxLineWidth) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    lines.push(currentLine);
    
    // Draw each line
    const lineHeight = Math.floor(width * 0.055);
    const totalTextHeight = lineHeight * lines.length;
    const startY = (height / 2) - (totalTextHeight / 2) + (height * 0.05);
    
    lines.forEach((line, i) => {
      const y = startY + (i * lineHeight);
      ctx.fillText(line, width / 2, y);
    });
    
    logger.info('Image generation completed successfully');
    
    // Return as buffer
    return canvas.toBuffer('image/jpeg', { quality: 0.9 });
  } catch (error) {
    logger.error('Error generating social media image:', error);
    throw new Error(`Failed to generate social media image: ${error.message}`);
  }
}

export default {
  generateSocialMediaImage
};