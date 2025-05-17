import express from 'express';
import Airtable from 'airtable';
import logger from '../utils/logger.js';
import config from '../config/index.js';
import imageGenerator from '../services/image-generator.js';
import { uploadImage } from '../services/cloudinary.js';

const router = express.Router();

// Define the roundRect function outside of your route handlers so it's available everywhere

// Add this helper function at the top of your file, after the imports but before the routes
function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  ctx.fill();
}

// Test GET endpoint
router.get('/generate', (req, res) => {
  res.json({
    success: true,
    message: 'The social media image generator endpoint is working',
    usage: 'Send a POST request to this endpoint with recordId, imageUrl, and title in the request body'
  });
});

// Root endpoint
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Social media images API is working',
    endpoints: {
      generate: '/api/social-media-images/generate',
      generateAll: '/api/social-media-images/generate-all'
    }
  });
});

/**
 * Generate social media image for a specific record
 * POST /api/social-media-images/generate
 */
router.post('/generate', async (req, res) => {
  try {
    const { recordId, platform = 'generic', imageUrl, title } = req.body;
    
    logger.info(`Received request to generate ${platform} image for record ${recordId}`);
    
    if (!recordId || !imageUrl || !title) {
      return res.status(400).json({
        success: false,
        error: 'Record ID, image URL, and title are required'
      });
    }
    
    // Test the image URL by trying to fetch headers
    try {
      const imageResponse = await fetch(imageUrl, { method: 'HEAD' });
      if (!imageResponse.ok) {
        return res.status(400).json({
          success: false,
          error: `Image URL returned status ${imageResponse.status}`
        });
      }
    } catch (imageError) {
      return res.status(400).json({
        success: false,
        error: `Could not access image URL: ${imageError.message}`
      });
    }
    
    // Get Airtable credentials
    const apiToken = config.airtable?.personalAccessToken || process.env.AIRTABLE_TOKEN;
    const baseId = config.airtable?.baseId || process.env.AIRTABLE_BASE_ID;
    
    if (!apiToken || !baseId) {
      logger.error('Missing Airtable credentials');
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: Missing Airtable credentials'
      });
    }
    
    // Generate the image preview (this doesn't get saved, but can be used in frontend)
    logger.info('Generating image preview with title overlay');
    const { createCanvas, loadImage } = await import('canvas');
    
    // Use better dimensions for preview image
    let width, height;
    switch (platform.toLowerCase()) {
      case 'instagram':
        width = 800;
        height = 800; // Square format
        break;
      case 'twitter':
        width = 1200;
        height = 675; // 16:9 ratio
        break;
      case 'facebook':
        width = 1200;
        height = 628; // Recommended for sharing
        break;
      default:
        width = 1200;
        height = 628; // Default format
    }
    
    // Create canvas
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Draw black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    
    try {
      // Load the source image
      const image = await loadImage(imageUrl);
      
      // Calculate aspect ratios
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
      
      // Draw the image
      ctx.drawImage(image, sx, sy, sWidth, sHeight, 0, 0, width, height);
      
      // Add a more sophisticated overlay for better readability
      const bottomGradientHeight = height * 0.5; // Use bottom half for gradient
      const gradient = ctx.createLinearGradient(0, height - bottomGradientHeight, 0, height);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0.8)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, height - bottomGradientHeight, width, bottomGradientHeight);
      
      // Add a subtle border/frame
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 2;
      ctx.strokeRect(5, 5, width - 10, height - 10);
      
      // Add your site's branding/logo
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px Arial';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('RDV NEWS', 20, 20);
      
      // For platform badge, make it more modern with a pill shape
      const platformText = platform.toUpperCase();
      const platformTextWidth = ctx.measureText(platformText).width;
      const badgeWidth = platformTextWidth + 20;
      const badgeHeight = 28;
      const badgeX = width - badgeWidth - 20;
      const badgeY = 20;
      
      // Draw badge background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      // Round rectangle function
      roundRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 14);
      
      // Draw platform text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(platformText, badgeX + badgeWidth/2, badgeY + badgeHeight/2);
      
      // Enhance title text styling
      // For the title, use a more modern approach:
      const formattedTitle = title.length > 100 ? title.substring(0, 97) + '...' : title;
      
      // Calculate font size based on canvas width - use dynamic sizing
      const titleLines = formattedTitle.split(' ').length;
      const fontSize = Math.min(
        Math.floor(width * 0.07), // Size based on width
        Math.floor(height * 0.1)  // Size based on height
      );
      
      // Add text shadow for better visibility
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
      
      ctx.font = `bold ${fontSize}px 'Arial', sans-serif`;
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'left';  // Left align looks more news-like
      ctx.textBaseline = 'bottom';  // Position from bottom
      
      // Text wrapping - keep lines shorter for better readability
      const words = formattedTitle.split(' ');
      const lines = [];
      let currentLine = words[0];
      
      const maxLineWidth = width * 0.85; // 85% of canvas width
      
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
      
      // Draw each line of text at the bottom of the image
      const lineHeight = fontSize * 1.2;
      const totalTextHeight = lineHeight * lines.length;
      const startY = height - 40;  // Position from bottom with padding
      
      // Draw each line of text
      for (let i = lines.length - 1; i >= 0; i--) {
        const y = startY - ((lines.length - 1 - i) * lineHeight);
        ctx.fillText(lines[i], width * 0.07, y);  // Left padding
      }
      
      // Add publication date or category (optional)
      const today = new Date();
      const dateStr = today.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
      
      ctx.font = '16px Arial';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(dateStr, width * 0.07, height - totalTextHeight - 50);
      
      // Reset shadow for other operations
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      
    } catch (drawError) {
      logger.error('Error drawing image:', drawError);
      
      // Just draw title text on black background
      ctx.font = 'bold 24px Arial';
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(title.substring(0, 50), width / 2, height / 2);
    }
    
    // Get the high-quality preview image for the response
    const previewDataUrl = canvas.toDataURL('image/jpeg', 0.9);
    
    // Initialize Airtable
    const airtable = new Airtable({ apiKey: apiToken });
    const base = airtable.base(baseId);
    
    // Create a timestamp for filenames
    const timestamp = new Date().toISOString().substring(0, 10);
    
    try {
      // Get high-quality buffer for Cloudinary
      const uploadBuffer = canvas.toBuffer('image/jpeg', { quality: 0.85 });
      
      // Upload to Cloudinary
      const fileName = `${platform.toLowerCase()}-${recordId}-${timestamp}.jpg`;
      const publicUrl = await uploadImage(uploadBuffer, fileName);
      
      // Create update object with the Cloudinary URL
      const updateFields = {};
      
      if (platform.toLowerCase() === 'instagram') {
        updateFields.social_image_instagram = [{
          filename: fileName,
          url: publicUrl
        }];
      } else if (platform.toLowerCase() === 'twitter') {
        updateFields.social_image_twitter = [{
          filename: fileName,
          url: publicUrl
        }];
      } else if (platform.toLowerCase() === 'facebook') {
        updateFields.social_image_facebook = [{
          filename: fileName,
          url: publicUrl
        }];
      } else {
        // Generic/default platform - update all fields
        const igFileName = `instagram-${recordId}-${timestamp}.jpg`;
        const twFileName = `twitter-${recordId}-${timestamp}.jpg`;
        const fbFileName = `facebook-${recordId}-${timestamp}.jpg`;
        
        const igUrl = await uploadImage(uploadBuffer, igFileName);
        const twUrl = await uploadImage(uploadBuffer, twFileName);
        const fbUrl = await uploadImage(uploadBuffer, fbFileName);
        
        updateFields.social_image_instagram = [{
          filename: igFileName,
          url: igUrl
        }];
        updateFields.social_image_twitter = [{
          filename: twFileName,
          url: twUrl
        }];
        updateFields.social_image_facebook = [{
          filename: fbFileName,
          url: fbUrl
        }];
      }
      
      // Update Airtable record
      await base('Redes Sociales').update(recordId, updateFields);
      
      return res.json({
        success: true,
        message: `Generated and uploaded image for ${platform}`,
        data: {
          recordId,
          platform,
          title: title,
          previewWithTitle: previewDataUrl,
          imageUrl: publicUrl
        }
      });
    } catch (uploadError) {
      logger.error('Error uploading image:', uploadError);
      
      return res.status(500).json({
        success: false,
        error: `Error uploading image: ${uploadError.message}`
      });
    }
  } catch (error) {
    logger.error('Error generating social media image:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate social media image'
    });
  }
});

/**
 * Generate social media images for multiple platforms
 * POST /api/social-media-images/generate-all
 */
router.post('/generate-all', async (req, res) => {
  try {
    const { recordId, imageUrl, title } = req.body;
    const platforms = ['facebook', 'twitter', 'instagram'];
    
    if (!recordId || !imageUrl || !title) {
      return res.status(400).json({
        success: false,
        error: 'Record ID, image URL, and title are required'
      });
    }
    
    // Test the image URL by trying to fetch headers
    try {
      const imageResponse = await fetch(imageUrl, { method: 'HEAD' });
      if (!imageResponse.ok) {
        return res.status(400).json({
          success: false,
          error: `Image URL returned status ${imageResponse.status}`
        });
      }
    } catch (imageError) {
      return res.status(400).json({
        success: false,
        error: `Could not access image URL: ${imageError.message}`
      });
    }
    
    // Get Airtable credentials
    const apiToken = config.airtable?.personalAccessToken || process.env.AIRTABLE_TOKEN;
    const baseId = config.airtable?.baseId || process.env.AIRTABLE_BASE_ID;
    
    if (!apiToken || !baseId) {
      logger.error('Missing Airtable credentials');
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: Missing Airtable credentials'
      });
    }
    
    // Initialize Airtable
    const airtable = new Airtable({ apiKey: apiToken });
    const base = airtable.base(baseId);
    
    // Process each platform
    const results = [];
    const updateFields = {};
    
    // Import canvas package
    const { createCanvas, loadImage } = await import('canvas');
    
    // Create timestamp for filenames
    const timestamp = new Date().toISOString().substring(0, 10);
    
    // Generate a preview image for the response (using Twitter dimensions)
    let previewDataUrl = null;
    
    // Generate a single image for all platforms (since they're all the same content)
    const width = 1200;
    const height = 628; // Default format
    
    // Create canvas
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Draw black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    
    try {
      // Load the source image
      const image = await loadImage(imageUrl);
      
      // Calculate aspect ratios
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
      
      // Draw the image
      ctx.drawImage(image, sx, sy, sWidth, sHeight, 0, 0, width, height);
      
      // Add a more sophisticated overlay for better readability
      const bottomGradientHeight = height * 0.5; // Use bottom half for gradient
      const gradient = ctx.createLinearGradient(0, height - bottomGradientHeight, 0, height);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0.8)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, height - bottomGradientHeight, width, bottomGradientHeight);
      
      // Add a subtle border/frame
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 2;
      ctx.strokeRect(5, 5, width - 10, height - 10);
      
      // Add your site's branding/logo
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px Arial';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('RDV NEWS', 20, 20);
      
      // For platform badge, make it more modern with a pill shape
      const platformText = 'SOCIAL MEDIA';
      const platformTextWidth = ctx.measureText(platformText).width;
      const badgeWidth = platformTextWidth + 20;
      const badgeHeight = 28;
      const badgeX = width - badgeWidth - 20;
      const badgeY = 20;
      
      // Draw badge background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      // Round rectangle function
      roundRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 14);
      
      // Draw platform text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(platformText, badgeX + badgeWidth/2, badgeY + badgeHeight/2);
      
      // Enhance title text styling
      // For the title, use a more modern approach:
      const formattedTitle = title.length > 100 ? title.substring(0, 97) + '...' : title;
      
      // Calculate font size based on canvas width - use dynamic sizing
      const titleLines = formattedTitle.split(' ').length;
      const fontSize = Math.min(
        Math.floor(width * 0.07), // Size based on width
        Math.floor(height * 0.1)  // Size based on height
      );
      
      // Add text shadow for better visibility
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
      
      ctx.font = `bold ${fontSize}px 'Arial', sans-serif`;
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'left';  // Left align looks more news-like
      ctx.textBaseline = 'bottom';  // Position from bottom
      
      // Text wrapping - keep lines shorter for better readability
      const words = formattedTitle.split(' ');
      const lines = [];
      let currentLine = words[0];
      
      const maxLineWidth = width * 0.85; // 85% of canvas width
      
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
      
      // Draw each line of text at the bottom of the image
      const lineHeight = fontSize * 1.2;
      const totalTextHeight = lineHeight * lines.length;
      const startY = height - 40;  // Position from bottom with padding
      
      // Draw each line of text
      for (let i = lines.length - 1; i >= 0; i--) {
        const y = startY - ((lines.length - 1 - i) * lineHeight);
        ctx.fillText(lines[i], width * 0.07, y);  // Left padding
      }
      
      // Add publication date or category (optional)
      const today = new Date();
      const dateStr = today.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
      
      ctx.font = '16px Arial';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(dateStr, width * 0.07, height - totalTextHeight - 50);
      
      // Reset shadow for other operations
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      
      // Create a high quality preview
      const previewCanvas = createCanvas(600, 335);
      const previewCtx = previewCanvas.getContext('2d');
      previewCtx.drawImage(canvas, 0, 0, width, height, 0, 0, 600, 335);
      previewDataUrl = previewCanvas.toDataURL('image/jpeg', 0.9);
      
      // Create a smaller size for Airtable uploads to address size limitations
      const smallerWidth = Math.floor(width/2);
      const smallerHeight = Math.floor(height/2);
      const smallerCanvas = createCanvas(smallerWidth, smallerHeight);
      const smallerCtx = smallerCanvas.getContext('2d');
      smallerCtx.drawImage(canvas, 0, 0, width, height, 0, 0, smallerWidth, smallerHeight);
      
      // Get the smaller size image as buffer and base64
      const facebookTwitterBuffer = smallerCanvas.toBuffer('image/jpeg', { quality: 0.6 });
      const facebookTwitterBase64 = facebookTwitterBuffer.toString('base64');
      
      // Create platform-specific versions if needed (e.g. for Instagram)
      // For Instagram, we need a square image but also smaller
      if (platforms.includes('instagram')) {
        const instagramCanvas = createCanvas(400, 400); // Half the original size
        const instagramCtx = instagramCanvas.getContext('2d');
        
        // Draw black background
        instagramCtx.fillStyle = '#000000';
        instagramCtx.fillRect(0, 0, 400, 400);
        
        // Draw the image proportionally - fixed variables
        const instagramImage = await loadImage(imageUrl);
        const imgAspect = instagramImage.width / instagramImage.height;
        
        let ix, iy, iw, ih;
        if (imgAspect > 1) {
          // Image is wider than tall, crop sides
          ih = instagramImage.height;
          iw = instagramImage.height;
          iy = 0;
          ix = (instagramImage.width - iw) / 2;
        } else {
          // Image is taller than wide, crop top/bottom
          iw = instagramImage.width;
          ih = instagramImage.width;
          ix = 0;
          iy = (instagramImage.height - ih) / 2;
        }
        
        // Draw the image
        instagramCtx.drawImage(instagramImage, ix, iy, iw, ih, 0, 0, 400, 400);
        
        // Add gradient
        const instagramGradient = instagramCtx.createLinearGradient(0, 200, 0, 400);
        instagramGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        instagramGradient.addColorStop(1, 'rgba(0, 0, 0, 0.8)');
        instagramCtx.fillStyle = instagramGradient;
        instagramCtx.fillRect(0, 200, 400, 200);
        
        // Add border
        instagramCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        instagramCtx.lineWidth = 2;
        instagramCtx.strokeRect(5, 5, 390, 390);
        
        // Add branding
        instagramCtx.fillStyle = '#ffffff';
        instagramCtx.font = 'bold 16px Arial';
        instagramCtx.textAlign = 'left';
        instagramCtx.textBaseline = 'top';
        instagramCtx.fillText('RDV NEWS', 20, 20);
        
        // Add Instagram badge
        const igText = 'INSTAGRAM';
        const igTextWidth = instagramCtx.measureText(igText).width;
        const igBadgeWidth = igTextWidth + 20;
        const igBadgeHeight = 28;
        const igBadgeX = 400 - igBadgeWidth - 20;
        const igBadgeY = 20;
        
        // Draw badge background
        instagramCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        roundRect(instagramCtx, igBadgeX, igBadgeY, igBadgeWidth, igBadgeHeight, 14);
        
        // Draw platform text
        instagramCtx.fillStyle = '#ffffff';
        instagramCtx.font = 'bold 14px Arial';
        instagramCtx.textAlign = 'center';
        instagramCtx.textBaseline = 'middle';
        instagramCtx.fillText(igText, igBadgeX + igBadgeWidth/2, igBadgeY + igBadgeHeight/2);
        
        // Add title
        instagramCtx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        instagramCtx.shadowBlur = 8;
        instagramCtx.shadowOffsetX = 2;
        instagramCtx.shadowOffsetY = 2;
        
        instagramCtx.font = `bold ${Math.floor(400 * 0.06)}px 'Arial', sans-serif`;
        instagramCtx.fillStyle = '#FFFFFF';
        instagramCtx.textAlign = 'left';
        instagramCtx.textBaseline = 'bottom';
        
        // Text wrapping
        const igWords = formattedTitle.split(' ');
        const igLines = [];
        let igCurrentLine = igWords[0];
        
        const igMaxLineWidth = 400 * 0.85;
        
        for (let i = 1; i < igWords.length; i++) {
          const word = igWords[i];
          const testLine = igCurrentLine + ' ' + word;
          const metrics = instagramCtx.measureText(testLine);
          
          if (metrics.width > igMaxLineWidth) {
            igLines.push(igCurrentLine);
            igCurrentLine = word;
          } else {
            igCurrentLine = testLine;
          }
        }
        igLines.push(igCurrentLine);
        
        // Draw each line of text
        const igLineHeight = Math.floor(400 * 0.06) * 1.2;
        const igTotalTextHeight = igLineHeight * igLines.length;
        const igStartY = 400 - 40;
        
        for (let i = igLines.length - 1; i >= 0; i--) {
          const y = igStartY - ((igLines.length - 1 - i) * igLineHeight);
          instagramCtx.fillText(igLines[i], 400 * 0.07, y);
        }
        
        // Add date
        instagramCtx.font = '14px Arial';
        instagramCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        instagramCtx.textAlign = 'left';
        instagramCtx.textBaseline = 'bottom';
        instagramCtx.fillText(dateStr, 400 * 0.07, 400 - igTotalTextHeight - 50);
        
        // Reset shadow
        instagramCtx.shadowColor = 'transparent';
        instagramCtx.shadowBlur = 0;
        instagramCtx.shadowOffsetX = 0;
        instagramCtx.shadowOffsetY = 0;
        
        // Get the Instagram-specific image buffer
        const igBuffer = instagramCanvas.toBuffer('image/jpeg', { quality: 0.6 });
        const igBase64 = igBuffer.toString('base64');
        
        // Set Instagram image
        updateFields.social_image_instagram = [{
          filename: `instagram-${timestamp}.jpg`,
          type: 'image/jpeg',
          content: igBase64
        }];
      } else {
        // Just use the standard image for Instagram as well
        updateFields.social_image_instagram = [{
          filename: `instagram-${timestamp}.jpg`,
          type: 'image/jpeg',
          content: facebookTwitterBase64
        }];
      }
      
      // Set Twitter and Facebook images
      updateFields.social_image_twitter = [{
        filename: `twitter-${timestamp}.jpg`,
        type: 'image/jpeg',
        content: facebookTwitterBase64
      }];
      
      updateFields.social_image_facebook = [{
        filename: `facebook-${timestamp}.jpg`,
        type: 'image/jpeg',
        content: facebookTwitterBase64
      }];
      
      platforms.forEach(platform => {
        results.push({
          platform,
          success: true,
          title: title
        });
      });
      
    } catch (previewError) {
      logger.error('Error creating image:', previewError);
      
      // Create a simple fallback preview
      const fallbackCanvas = createCanvas(600, 335);
      const fallbackCtx = fallbackCanvas.getContext('2d');
      
      fallbackCtx.fillStyle = '#000000';
      fallbackCtx.fillRect(0, 0, 600, 335);
      fallbackCtx.fillStyle = '#FFFFFF';
      fallbackCtx.font = 'bold 24px Arial';
      fallbackCtx.textAlign = 'center';
      fallbackCtx.textBaseline = 'middle';
      fallbackCtx.fillText(title.substring(0, 50), 300, 168);
      fallbackCtx.font = '16px Arial';
      fallbackCtx.fillText('Error processing image', 300, 200);
      
      previewDataUrl = fallbackCanvas.toDataURL('image/jpeg');
      
      // Set fallback images in Airtable (plain black with text)
      // Make sure they're small for Airtable
      const fallbackBuffer = fallbackCanvas.toBuffer('image/jpeg', { quality: 0.5 });
      const fallbackBase64 = fallbackBuffer.toString('base64');
      
      updateFields.social_image_facebook = [{
        filename: `facebook-${timestamp}.jpg`,
        type: 'image/jpeg',
        content: fallbackBase64
      }];
      
      updateFields.social_image_twitter = [{
        filename: `twitter-${timestamp}.jpg`,
        type: 'image/jpeg',
        content: fallbackBase64
      }];
      
      updateFields.social_image_instagram = [{
        filename: `instagram-${timestamp}.jpg`,
        type: 'image/jpeg',
        content: fallbackBase64
      }];
      
      platforms.forEach(platform => {
        results.push({
          platform,
          success: false,
          error: previewError.message,
          title: title
        });
      });
    }
    
    // Update the /generate-all endpoint to use Cloudinary

    // In the /generate-all endpoint, replace the Airtable attachment section with:

    try {
      // Get high-quality buffers for each platform
      const fbtwBuffer = canvas.toBuffer('image/jpeg', { quality: 0.85 });
      
      // Create Instagram-specific image if needed
      let instagramCanvas;
      let igBuffer;
      
      if (platforms.includes('instagram')) {
        // Create Instagram-specific canvas (square format)
        instagramCanvas = createCanvas(800, 800);
        const instagramCtx = instagramCanvas.getContext('2d');
        
        // Add this line to define formattedTitle
        const formattedTitle = title.length > 100 ? title.substring(0, 97) + '...' : title;
        
        // Add this line to define dateStr for Instagram image
        const today = new Date();
        const dateStr = today.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
        
        // Draw black background
        instagramCtx.fillStyle = '#000000';
        
        // ...rest of the Instagram image creation code
        // Draw black background
        instagramCtx.fillStyle = '#000000';
        instagramCtx.fillRect(0, 0, 800, 800);
        
        // Draw the image proportionally
        const instagramImage = await loadImage(imageUrl);
        const imgAspect = instagramImage.width / instagramImage.height;
        
        let ix, iy, iw, ih;
        if (imgAspect > 1) {
          // Image is wider than tall, crop sides
          ih = instagramImage.height;
          iw = instagramImage.height;
          iy = 0;
          ix = (instagramImage.width - iw) / 2;
        } else {
          // Image is taller than wide, crop top/bottom
          iw = instagramImage.width;
          ih = instagramImage.width;
          ix = 0;
          iy = (instagramImage.height - ih) / 2;
        }
        
        // Draw the image
        instagramCtx.drawImage(instagramImage, ix, iy, iw, ih, 0, 0, 800, 800);
        
        // Add gradient
        const instagramGradient = instagramCtx.createLinearGradient(0, 400, 0, 800);
        instagramGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        instagramGradient.addColorStop(1, 'rgba(0, 0, 0, 0.8)');
        instagramCtx.fillStyle = instagramGradient;
        instagramCtx.fillRect(0, 400, 800, 400);
        
        // Add border
        instagramCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        instagramCtx.lineWidth = 2;
        instagramCtx.strokeRect(5, 5, 790, 790);
        
        // Add branding
        instagramCtx.fillStyle = '#ffffff';
        instagramCtx.font = 'bold 20px Arial';
        instagramCtx.textAlign = 'left';
        instagramCtx.textBaseline = 'top';
        instagramCtx.fillText('RDV NEWS', 20, 20);
        
        // Add Instagram badge
        const igText = 'INSTAGRAM';
        const igTextWidth = instagramCtx.measureText(igText).width;
        const igBadgeWidth = igTextWidth + 20;
        const igBadgeHeight = 28;
        const igBadgeX = 800 - igBadgeWidth - 20;
        const igBadgeY = 20;
        
        // Draw badge background using the roundRect function
        instagramCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        roundRect(instagramCtx, igBadgeX, igBadgeY, igBadgeWidth, igBadgeHeight, 14);
        
        // Draw platform text
        instagramCtx.fillStyle = '#ffffff';
        instagramCtx.font = 'bold 14px Arial';
        instagramCtx.textAlign = 'center';
        instagramCtx.textBaseline = 'middle';
        instagramCtx.fillText(igText, igBadgeX + igBadgeWidth/2, igBadgeY + igBadgeHeight/2);
        
        // Add title
        instagramCtx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        instagramCtx.shadowBlur = 8;
        instagramCtx.shadowOffsetX = 2;
        instagramCtx.shadowOffsetY = 2;
        
        instagramCtx.font = `bold ${Math.floor(800 * 0.05)}px 'Arial', sans-serif`;
        instagramCtx.fillStyle = '#FFFFFF';
        instagramCtx.textAlign = 'left';
        instagramCtx.textBaseline = 'bottom';
        
        // Text wrapping
        const igWords = formattedTitle.split(' ');
        const igLines = [];
        let igCurrentLine = igWords[0];
        
        const igMaxLineWidth = 800 * 0.85;
        
        for (let i = 1; i < igWords.length; i++) {
          const word = igWords[i];
          const testLine = igCurrentLine + ' ' + word;
          const metrics = instagramCtx.measureText(testLine);
          
          if (metrics.width > igMaxLineWidth) {
            igLines.push(igCurrentLine);
            igCurrentLine = word;
          } else {
            igCurrentLine = testLine;
          }
        }
        igLines.push(igCurrentLine);
        
        // Draw each line of text
        const igLineHeight = Math.floor(800 * 0.05) * 1.2;
        const igTotalTextHeight = igLineHeight * igLines.length;
        const igStartY = 800 - 40;
        
        for (let i = igLines.length - 1; i >= 0; i--) {
          const y = igStartY - ((igLines.length - 1 - i) * igLineHeight);
          instagramCtx.fillText(igLines[i], 800 * 0.07, y);
        }
        
        // Add date
        instagramCtx.font = '16px Arial';
        instagramCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        instagramCtx.textAlign = 'left';
        instagramCtx.textBaseline = 'bottom';
        instagramCtx.fillText(dateStr, 800 * 0.07, 800 - igTotalTextHeight - 50);
        
        // Reset shadow
        instagramCtx.shadowColor = 'transparent';
        instagramCtx.shadowBlur = 0;
        instagramCtx.shadowOffsetX = 0;
        instagramCtx.shadowOffsetY = 0;
        
        // Get Instagram buffer for Cloudinary
        igBuffer = instagramCanvas.toBuffer('image/jpeg', { quality: 0.85 });
      } else {
        // If Instagram is not in the platforms list, just use the default canvas
        igBuffer = fbtwBuffer;
      }
      
      // Create unique filenames for each platform
      const fbFileName = `facebook-${recordId}-${timestamp}.jpg`;
      const twFileName = `twitter-${recordId}-${timestamp}.jpg`;
      const igFileName = `instagram-${recordId}-${timestamp}.jpg`;
      
      // Upload images to Cloudinary (in parallel for speed)
      const [fbUrl, twUrl, igUrl] = await Promise.all([
        uploadImage(fbtwBuffer, fbFileName),
        uploadImage(fbtwBuffer, twFileName),
        uploadImage(igBuffer, igFileName)
      ]);
      
      // Create update object with Cloudinary URLs
      const updateFields = {
        social_image_facebook: [{
          filename: fbFileName,
          url: fbUrl
        }],
        social_image_twitter: [{
          filename: twFileName,
          url: twUrl
        }],
        social_image_instagram: [{
          filename: igFileName,
          url: igUrl
        }]
      };
      
      // Update Airtable record
      await base('Redes Sociales').update(recordId, updateFields);
      
      // Prepare results for response
      const platformResults = [];
      platformResults.push({
        platform: 'facebook',
        success: true,
        title: title,
        imageUrl: fbUrl
      });
      platformResults.push({
        platform: 'twitter',
        success: true,
        title: title,
        imageUrl: twUrl
      });
      platformResults.push({
        platform: 'instagram',
        success: true,
        title: title,
        imageUrl: igUrl
      });
      
      return res.json({
        success: true,
        message: 'Generated and uploaded social media images for all platforms',
        data: {
          recordId,
          results: platformResults,
          title,
          previewWithTitle: previewDataUrl
        }
      });
    } catch (uploadError) {
      logger.error('Error uploading images:', uploadError);
      
      // Add error results
      const errorResults = platforms.map(platform => ({
        platform,
        success: false,
        error: uploadError.message,
        title: title
      }));
      
      return res.status(500).json({
        success: false,
        error: `Failed to upload images: ${uploadError.message}`,
        data: {
          recordId,
          results: errorResults,
          previewWithTitle: previewDataUrl
        }
      });
    }
  } catch (error) {
    logger.error('Error attaching social media images:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to attach social media images'
    });
  }
});

export default router;