import express from 'express';
import Airtable from 'airtable';
import logger from '../utils/logger.js';
import config from '../config/index.js';
import imageGenerator from '../services/image-generator.js';

const router = express.Router();

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
      function roundRect(x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + width, y, x + width, y + height, radius);
        ctx.arcTo(x + width, y + height, x, y + height, radius);
        ctx.arcTo(x, y + height, x, y, radius);
        ctx.arcTo(x, y, x + width, y, radius);
        ctx.closePath();
        ctx.fill();
      }
      roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 14);
      
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
    
    // Get the image buffer and convert to base64 for attachment
    const imageBuffer = canvas.toBuffer('image/jpeg', { quality: 0.85 });
    const base64Image = imageBuffer.toString('base64');
    
    // Get the preview image as a data URL for the response
    const previewDataUrl = canvas.toDataURL('image/jpeg');
    
    // Initialize Airtable
    const airtable = new Airtable({ apiKey: apiToken });
    const base = airtable.base(baseId);
    
    // Create a timestamp for filenames
    const timestamp = new Date().toISOString().substring(0, 10);
    const fileName = `${platform}-${timestamp}.jpg`;
    
    try {
      // Create update object with correct field name for the specified platform
      const updateFields = {};
      
      // Use the correct field name based on platform and upload the processed image
      if (platform.toLowerCase() === 'instagram') {
        updateFields.social_image_instagram = [{
          filename: fileName,
          type: 'image/jpeg', // Add content type
          content: base64Image
        }];
      } else if (platform.toLowerCase() === 'twitter') {
        updateFields.social_image_twitter = [{
          filename: fileName,
          type: 'image/jpeg', // Add content type
          content: base64Image
        }];
      } else if (platform.toLowerCase() === 'facebook') {
        updateFields.social_image_facebook = [{
          filename: fileName,
          type: 'image/jpeg', // Add content type
          content: base64Image
        }];
      } else {
        // Generic/default platform - update all fields
        updateFields.social_image_instagram = [{
          filename: `instagram-${timestamp}.jpg`,
          type: 'image/jpeg', // Add content type
          content: base64Image
        }];
        updateFields.social_image_twitter = [{
          filename: `twitter-${timestamp}.jpg`,
          type: 'image/jpeg', // Add content type
          content: base64Image
        }];
        updateFields.social_image_facebook = [{
          filename: `facebook-${timestamp}.jpg`,
          type: 'image/jpeg', // Add content type
          content: base64Image
        }];
      }
      
      // Update Airtable record
      await base('Redes Sociales').update(recordId, updateFields);
      
      return res.json({
        success: true,
        message: `Attached image with title overlay for ${platform}`,
        data: {
          recordId,
          platform,
          title: title, // Include title in response
          previewWithTitle: previewDataUrl // Send the preview image with title overlay
        }
      });
    } catch (airtableError) {
      logger.error('Airtable update error:', airtableError);
      
      return res.status(500).json({
        success: false,
        error: `Error updating Airtable record: ${airtableError.message}`
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
      function roundRect(x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + width, y, x + width, y + height, radius);
        ctx.arcTo(x + width, y + height, x, y + height, radius);
        ctx.arcTo(x, y + height, x, y, radius);
        ctx.arcTo(x, y, x + width, y, radius);
        ctx.closePath();
        ctx.fill();
      }
      roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 14);
      
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
      
      // Get the common overlaid image for all platforms as buffer and base64
      const imageBuffer = canvas.toBuffer('image/jpeg', { quality: 0.85 });
      const base64Image = imageBuffer.toString('base64');
      
      // Create platform-specific versions if needed (e.g. for Instagram)
      // For Instagram, we need a square image
      if (platforms.includes('instagram')) {
        const instagramCanvas = createCanvas(800, 800);
        const instagramCtx = instagramCanvas.getContext('2d');
        
        // Draw black background
        instagramCtx.fillStyle = '#000000';
        instagramCtx.fillRect(0, 0, 800, 800);
        
        // Draw the image proportionally
        const instagramImage = await loadImage(imageUrl);
        const imgAspect = instagramImage.width / instagramImage.height;
        
        let ix, iy, iw, ih;
        if (imgAspect > 1) {
          ih = instagramImage.height;
          iw = instagramImage.height;
          iy = 0;
          ix = (instagramImage.width - iw) / 2;
        } else {
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
        
        // Draw badge background
        instagramCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        roundRect.call(instagramCtx, igBadgeX, igBadgeY, igBadgeWidth, igBadgeHeight, 14);
        
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
        
        instagramCtx.font = `bold ${Math.floor(800 * 0.06)}px 'Arial', sans-serif`;
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
        const igLineHeight = Math.floor(800 * 0.06) * 1.2;
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
        
        // Get the Instagram-specific image buffer
        const igBuffer = instagramCanvas.toBuffer('image/jpeg', { quality: 0.85 });
        const igBase64 = igBuffer.toString('base64');
        
        // Set Instagram image
        updateFields.social_image_instagram = [{
          filename: `instagram-${timestamp}.jpg`,
          type: 'image/jpeg', // Add content type
          content: igBase64
        }];
      } else {
        // Just use the standard image for Instagram as well
        updateFields.social_image_instagram = [{
          filename: `instagram-${timestamp}.jpg`,
          type: 'image/jpeg', // Add content type
          content: base64Image
        }];
      }
      
      // Set Twitter and Facebook images
      updateFields.social_image_twitter = [{
        filename: `twitter-${timestamp}.jpg`,
        type: 'image/jpeg', // Add content type
        content: base64Image
      }];
      
      updateFields.social_image_facebook = [{
        filename: `facebook-${timestamp}.jpg`,
        type: 'image/jpeg', // Add content type
        content: base64Image
      }];
      
      // Create a smaller preview version for the response
      const previewCanvas = createCanvas(600, 335);
      const previewCtx = previewCanvas.getContext('2d');
      previewCtx.drawImage(canvas, 0, 0, width, height, 0, 0, 600, 335);
      previewDataUrl = previewCanvas.toDataURL('image/jpeg', 0.7);
      
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
      const fallbackBuffer = fallbackCanvas.toBuffer('image/jpeg');
      const fallbackBase64 = fallbackBuffer.toString('base64');
      
      updateFields.social_image_facebook = [{
        filename: `facebook-${timestamp}.jpg`,
        type: 'image/jpeg', // Add content type
        content: fallbackBase64
      }];
      
      updateFields.social_image_twitter = [{
        filename: `twitter-${timestamp}.jpg`,
        type: 'image/jpeg', // Add content type
        content: fallbackBase64
      }];
      
      updateFields.social_image_instagram = [{
        filename: `instagram-${timestamp}.jpg`,
        type: 'image/jpeg', // Add content type
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
    
    // Update the record in Airtable with all social media images
    try {
      await base('Redes Sociales').update(recordId, updateFields);
      
      return res.json({
        success: true,
        message: 'Attached social media images with title overlay for all platforms',
        data: {
          recordId,
          results,
          title,
          previewWithTitle: previewDataUrl
        }
      });
    } catch (airtableError) {
      logger.error('Airtable update error:', airtableError);
      
      return res.status(500).json({
        success: false,
        error: `Error updating Airtable record: ${airtableError.message}`
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