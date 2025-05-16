import { createCanvas, loadImage, registerFont } from 'canvas';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger.js';
import config from '../config/index.js';

// Register fonts if needed
try {
  // Make sure these font files exist in your project
  registerFont(path.join(process.cwd(), 'assets/fonts/Montserrat-Bold.ttf'), { family: 'Montserrat', weight: 'bold' });
  registerFont(path.join(process.cwd(), 'assets/fonts/Montserrat-Regular.ttf'), { family: 'Montserrat' });
} catch (error) {
  logger.warn('Could not register fonts:', error.message);
}

/**
 * Generate a social media image with title overlay
 * @param {Object} data - The data needed to generate the image
 * @param {string} data.imageUrl - URL of the base image
 * @param {string} data.title - Title to overlay on the image
 * @param {string} data.platform - Target platform (instagram, twitter, facebook)
 * @returns {Promise<string>} - URL of the generated image
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
    
    // Create canvas with the specified dimensions
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Load the source image
    const image = await loadImage(imageUrl);
    
    // Calculate aspect ratios to ensure proper fit
    const imageAspect = image.width / image.height;
    const canvasAspect = width / height;
    
    let sx, sy, sWidth, sHeight;
    
    if (imageAspect > canvasAspect) {
      // Image is wider than canvas (crop sides)
      sHeight = image.height;
      sWidth = image.height * canvasAspect;
      sy = 0;
      sx = (image.width - sWidth) / 2;
    } else {
      // Image is taller than canvas (crop top/bottom)
      sWidth = image.width;
      sHeight = image.width / canvasAspect;
      sx = 0;
      sy = (image.height - sHeight) / 3; // Crop more from bottom than top
    }
    
    // Draw the image with proper cropping
    ctx.drawImage(image, sx, sy, sWidth, sHeight, 0, 0, width, height);
    
    // Add a semi-transparent overlay for better text visibility
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, width, height);
    
    // Add your logo or branding
    try {
      const logo = await loadImage(path.join(process.cwd(), 'assets/images/logo.png'));
      const logoWidth = width * 0.25; // 25% of the image width
      const logoHeight = logoWidth * (logo.height / logo.width);
      const logoX = 30;
      const logoY = 30;
      ctx.drawImage(logo, logoX, logoY, logoWidth, logoHeight);
    } catch (logoError) {
      logger.warn('Could not load logo:', logoError.message);
    }
    
    // Add the title text
    const formattedTitle = formatTitle(title, 24); // Format to max 24 words
    
    ctx.font = `bold ${width * 0.05}px Montserrat, Arial, sans-serif`;
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Calculate positioning for multi-line text
    const lines = formattedTitle.split('\n');
    const lineHeight = width * 0.055;
    const totalTextHeight = lineHeight * lines.length;
    const startY = (height / 2) - (totalTextHeight / 2) + (height * 0.1); // Center with slight downward bias
    
    // Draw each line of text
    lines.forEach((line, i) => {
      const y = startY + (i * lineHeight);
      ctx.fillText(line, width / 2, y);
    });
    
    // Save image to file
    const fileName = `social-${uuidv4()}.jpg`;
    const outputDir = path.join(process.cwd(), 'public/generated');
    
    // Ensure directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const outputPath = path.join(outputDir, fileName);
    const stream = fs.createWriteStream(outputPath);
    
    // Create a Promise that resolves when the stream is finished
    const savePromise = new Promise((resolve, reject) => {
      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    });
    
    // Create a buffer with the image data and send it to the stream
    const buffer = canvas.toBuffer('image/jpeg', { quality: 0.9 });
    stream.write(buffer);
    stream.end();
    
    // Wait for the save to complete
    await savePromise;
    
    // Determine the public URL
    const baseUrl = config.baseUrl || `http://localhost:${process.env.PORT || 3000}`;
    const imageUrl = `${baseUrl}/generated/${fileName}`;
    
    logger.info(`Generated social media image: ${imageUrl}`);
    
    return {
      url: imageUrl,
      path: outputPath,
      width,
      height
    };
  } catch (error) {
    logger.error('Error generating social media image:', error);
    throw new Error(`Failed to generate social media image: ${error.message}`);
  }
}

/**
 * Format title text for better display
 * @param {string} title - The original title
 * @param {number} maxWords - Maximum words before wrap
 * @returns {string} - Formatted title with line breaks
 */
function formatTitle(title, maxWords = 24) {
  if (!title) return '';
  
  // Remove any existing line breaks and replace with spaces
  let processedTitle = title.replace(/\r?\n|\r/g, ' ').trim();
  
  // Split the title into words
  const words = processedTitle.split(' ');
  
  // If title is short enough, return as is
  if (words.length <= maxWords) return processedTitle;
  
  // Otherwise, split into chunks of approximately equal size
  const lines = [];
  let currentLine = [];
  const wordsPerLine = Math.ceil(words.length / Math.ceil(words.length / maxWords));
  
  words.forEach((word, index) => {
    currentLine.push(word);
    
    if (currentLine.length >= wordsPerLine && index < words.length - 1) {
      lines.push(currentLine.join(' '));
      currentLine = [];
    }
  });
  
  // Add any remaining words
  if (currentLine.length > 0) {
    lines.push(currentLine.join(' '));
  }
  
  return lines.join('\n');
}

export default {
  generateSocialMediaImage
};