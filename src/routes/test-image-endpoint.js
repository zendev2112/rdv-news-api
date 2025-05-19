// test-image-endpoint.js
import express from 'express';
import { createCanvas } from 'canvas';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import textRenderer from './services/text-renderer.js';
import logger from './utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

// Test GET endpoint that renders a test image with various fonts
router.get('/', async (req, res) => {
  try {
    // Create a canvas for testing
    const width = 800;
    const height = 600;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Fill the background
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(0, 0, width, height);
    
    // Add a title
    ctx.fillStyle = '#ecf0f1';
    ctx.font = `bold 36px ${textRenderer.getBestAvailableFont()}`;
    ctx.textAlign = 'center';
    ctx.fillText('Text Rendering Test', width / 2, 50);
    
    // Draw line
    ctx.strokeStyle = '#3498db';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(50, 80);
    ctx.lineTo(width - 50, 80);
    ctx.stroke();
    
    // Draw test text
    let y = 120;
    const testStrings = [
      'Basic ASCII text - This should always work',
      'International text: áéíóúñ çãõ ¡¿ üöä',
      'Symbols: ©®™ §¶† ♠♣♥♦ ★☆',
      'Емоджи и кириллица - Emoji and Cyrillic',
      '漢字 - CJK characters'
    ];
    
    // Label for font being used
    ctx.font = `14px ${textRenderer.getBestAvailableFont()}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f39c12';
    ctx.fillText(`Using font: ${textRenderer.getBestAvailableFont()}`, 50, 100);
    
    for (let i = 0; i < testStrings.length; i++) {
      const text = testStrings[i];
      
      // Draw with direct text rendering
      ctx.fillStyle = '#ecf0f1';
      ctx.font = `bold 24px ${textRenderer.getBestAvailableFont()}`;
      ctx.textAlign = 'left';
      ctx.fillText(`Direct: ${text}`, 50, y);
      
      // Draw with wrapped text renderer
      textRenderer.drawWrappedText(
        ctx,
        `Fallback: ${text}`,
        50,
        y + 40,
        width - 100,
        30,
        {
          fontSize: 24,
          color: '#2ecc71',
          fontWeight: 'normal',
          textAlign: 'left'
        }
      );
      
      y += 100;
    }
    
    // Add a timestamp
    const timestamp = new Date().toISOString();
    ctx.font = `14px ${textRenderer.getBestAvailableFont()}`;
    ctx.fillStyle = '#95a5a6';
    ctx.textAlign = 'right';
    ctx.fillText(`Generated: ${timestamp}`, width - 50, height - 30);
    
    // Send the image as response
    res.contentType('image/jpeg');
    const buffer = canvas.toBuffer('image/jpeg', { quality: 0.9 });
    res.send(buffer);
    
    // Also save locally for debugging
    fs.writeFileSync(path.join(__dirname, 'test-rendering.jpg'), buffer);
    logger.info('Text rendering test image saved to test-rendering.jpg');
    
  } catch (error) {
    logger.error('Error generating test image:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate test image'
    });
  }
});

export default router;
