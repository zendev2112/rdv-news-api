// text-renderer.js
import { registerFont } from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fontDir = path.join(__dirname, '../../assets/fonts');

// Keep track of which fonts are available
const availableFonts = {
  roboto: false,
  system: false,
  fallback: true  // We always have some fallback
};

/**
 * Initialize all available fonts
 */
export async function initializeFonts() {
  // Create fonts directory if needed
  if (!fs.existsSync(fontDir)) {
    fs.mkdirSync(fontDir, { recursive: true });
  }
  
  // Try to register custom downloaded fonts
  const robotoRegularPath = path.join(fontDir, 'Roboto-Regular.ttf');
  const robotoBoldPath = path.join(fontDir, 'Roboto-Bold.ttf');
  
  try {
    if (fs.existsSync(robotoRegularPath)) {
      registerFont(robotoRegularPath, { family: 'Roboto' });
      logger.info('Registered Roboto Regular font');
      
      if (fs.existsSync(robotoBoldPath)) {
        registerFont(robotoBoldPath, { family: 'Roboto', weight: 'bold' });
        logger.info('Registered Roboto Bold font');
      }
      
      availableFonts.roboto = true;
    } else {
      logger.warn('Roboto fonts not found, will try system fonts');
    }
  } catch (error) {
    logger.warn('Failed to register Roboto fonts:', error.message);
  }
  
  // Try to register system fonts if custom fonts failed
  if (!availableFonts.roboto) {
    try {
      // Common system font paths
      const systemFonts = [
        // Linux
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
        '/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf',
        // Windows equivalent paths for WSL
        '/mnt/c/Windows/Fonts/arial.ttf',
        '/mnt/c/Windows/Fonts/calibri.ttf'
      ];
      
      for (const fontPath of systemFonts) {
        if (fs.existsSync(fontPath)) {
          const fontName = path.basename(fontPath, '.ttf').replace(/[-_]/g, '');
          try {
            registerFont(fontPath, { family: fontName });
            availableFonts.system = true;
            logger.info(`Registered system font: ${fontName}`);
          } catch (e) {
            logger.warn(`Failed to register ${fontName}:`, e.message);
          }
        }
      }
      
      if (availableFonts.system) {
        logger.info('Successfully registered system fonts');
      } else {
        logger.warn('No system fonts could be registered');
      }
    } catch (error) {
      logger.warn('Failed to register system fonts:', error.message);
    }
  }
  
  return availableFonts;
}

/**
 * Get best available font family for canvas
 * @returns {string} Font family name
 */
export function getBestAvailableFont() {
  if (availableFonts.roboto) {
    return 'Roboto';
  } else if (availableFonts.system) {
    // Return the first system font that worked
    return 'DejaVuSans, LiberationSans, Ubuntu';
  } else {
    return 'sans-serif'; // Canvas built-in fallback
  }
}

/**
 * Draw text with proper fallbacks if fonts don't render
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {string} text - Text to render
 * @param {number} x - X position
 * @param {number} y - Y position 
 * @param {Object} options - Additional options
 */
export function drawText(ctx, text, x, y, options = {}) {
  const {
    fontSize = 24,
    fontWeight = 'normal',
    fontFamily = getBestAvailableFont(),
    color = '#FFFFFF',
    textAlign = 'left',
    maxWidth = undefined,
    testMode = false
  } = options;
  
  // Save original settings
  ctx.save();
  
  // Apply text rendering settings
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = color;
  ctx.textAlign = textAlign;
  
  try {
    // First try the normal text drawing
    ctx.fillText(text, x, y, maxWidth);
    
    // For testing, we'll draw a border around the text area
    if (testMode) {
      const metrics = ctx.measureText(text);
      const width = metrics.width;
      const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
      
      ctx.strokeStyle = '#FF0000';
      ctx.lineWidth = 1;
      
      let boxX = x;
      if (textAlign === 'center') {
        boxX = x - (width / 2);
      } else if (textAlign === 'right') {
        boxX = x - width;
      }
      
      ctx.strokeRect(boxX, y - metrics.actualBoundingBoxAscent, width, height);
    }
  } catch (error) {
    logger.warn('Error rendering text with fonts, using fallback rectangles:', error.message);
    
    // Fallback to rectangles if text rendering fails
    drawTextRectangles(ctx, x, y, 
      ctx.measureText(text).width || text.length * fontSize * 0.6, 
      fontSize, color, textAlign);
  }
  
  // Restore original settings
  ctx.restore();
}

/**
 * Draw wrapped text (multi-line) with proper fallbacks
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {string} text - Text to render 
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} maxWidth - Maximum width before wrapping
 * @param {number} lineHeight - Height between lines
 * @param {Object} options - Additional options
 */
export function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, options = {}) {
  // Don't attempt to draw empty text
  if (!text || text.trim() === '') return;
  
  // Process the text into lines
  const words = text.split(' ');
  const lines = [];
  let currentLine = words[0];
  
  // Save original settings
  ctx.save();
  
  // Apply text settings for measurement
  const { 
    fontSize = 24,
    fontWeight = 'normal',
    fontFamily = getBestAvailableFont(),
    color = '#FFFFFF',
    textAlign = 'left',
    testMode = false
  } = options;
  
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  
  // Break into lines
  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const testLine = currentLine + ' ' + word;
    const metrics = ctx.measureText(testLine);
    
    if (metrics.width > maxWidth) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  lines.push(currentLine);
  
  // Restore settings
  ctx.restore();
  
  // Draw each line
  lines.forEach((line, i) => {
    const lineY = y + (i * lineHeight);
    drawText(ctx, line, x, lineY, { ...options, maxWidth });
  });
  
  // For testing, draw a border around the text block
  if (testMode) {
    ctx.save();
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 2;
    
    let boxX = x;
    if (textAlign === 'center') {
      boxX = x - (maxWidth / 2);
    } else if (textAlign === 'right') {
      boxX = x - maxWidth;
    }
    
    ctx.strokeRect(boxX, y - fontSize, maxWidth, lines.length * lineHeight);
    ctx.restore();
  }
  
  return lines.length * lineHeight; // Return total height
}

/**
 * Draw solid colored rectangles as text replacement
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x - X position (depends on alignment)
 * @param {number} y - Y position (baseline)
 * @param {number} width - Width of text block
 * @param {number} height - Height of text block
 * @param {string} color - Text color
 * @param {string} textAlign - Text alignment (left, center, right)
 */
function drawTextRectangles(ctx, x, y, width, height, color = '#FFFFFF', textAlign = 'left') {
  const charCount = Math.floor(width / (height * 0.5)); // Simulate characters
  const charWidth = height * 0.5;
  const charSpacing = height * 0.1;
  const totalWidth = charCount * (charWidth + charSpacing);
  
  // Adjust x based on textAlign
  let startX = x;
  if (textAlign === 'center') {
    startX = x - (totalWidth / 2);
  } else if (textAlign === 'right') {
    startX = x - totalWidth;
  }
  
  // Draw rectangles
  ctx.save();
  ctx.fillStyle = color;
  
  for (let i = 0; i < charCount; i++) {
    const rectX = startX + (i * (charWidth + charSpacing));
    const rectY = y - (height * 0.8); // Place rectangles relative to baseline
    
    // Draw rectangle for each "character"
    ctx.fillRect(rectX, rectY, charWidth, height * 0.8);
  }
  
  ctx.restore();
}

// Initialize fonts on module import
await initializeFonts();

export default {
  drawText,
  drawWrappedText,
  getBestAvailableFont,
  initializeFonts
};
