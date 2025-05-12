import { createCanvas, loadImage, registerFont } from 'canvas';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Make sure assets folders exist
const assetsDir = path.join(__dirname, '../assets');
const fontsDir = path.join(assetsDir, 'fonts');
const imagesDir = path.join(assetsDir, 'images');

// Create directories if they don't exist
[assetsDir, fontsDir, imagesDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Download fonts if they don't exist
async function ensureFontsExist() {
  const fontFiles = [
    { name: 'Montserrat-Bold.ttf', url: 'https://github.com/JulietaUla/Montserrat/raw/master/fonts/ttf/Montserrat-Bold.ttf' },
    { name: 'Montserrat-Regular.ttf', url: 'https://github.com/JulietaUla/Montserrat/raw/master/fonts/ttf/Montserrat-Regular.ttf' },
    { name: 'Montserrat-Italic.ttf', url: 'https://github.com/JulietaUla/Montserrat/raw/master/fonts/ttf/Montserrat-Italic.ttf' }
  ];

  for (const font of fontFiles) {
    const fontPath = path.join(fontsDir, font.name);
    
    if (!fs.existsSync(fontPath)) {
      console.log(`Downloading font: ${font.name}`);
      const response = await fetch(font.url);
      const fontData = await response.arrayBuffer();
      fs.writeFileSync(fontPath, Buffer.from(fontData));
    }
  }
  
  // Register fonts with canvas
  registerFont(path.join(fontsDir, 'Montserrat-Bold.ttf'), { family: 'Montserrat', weight: 'bold' });
  registerFont(path.join(fontsDir, 'Montserrat-Regular.ttf'), { family: 'Montserrat' });
  registerFont(path.join(fontsDir, 'Montserrat-Italic.ttf'), { family: 'Montserrat', style: 'italic' });
}

// Create default logo if it doesn't exist
async function ensureLogoExists() {
  const logoPath = path.join(imagesDir, 'rdv-logo.png');
  
  if (!fs.existsSync(logoPath)) {
    // Create a simple text logo as a fallback
    const logoCanvas = createCanvas(200, 80);
    const ctx = logoCanvas.getContext('2d');
    
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 200, 80);
    
    ctx.fillStyle = '#3355AA';
    ctx.font = 'bold 32px Montserrat';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('RDV NEWS', 100, 40);
    
    const buffer = logoCanvas.toBuffer('image/png');
    fs.writeFileSync(logoPath, buffer);
  }
}

// Helper to draw wrapped text with maximum lines
function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 0) {
  const words = text.split(' ');
  let line = '';
  let lines = [];
  
  // Build the lines
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;
    
    if (testWidth > maxWidth && n > 0) {
      lines.push(line);
      line = words[n] + ' ';
    } else {
      line = testLine;
    }
  }
  
  // Add the last line
  lines.push(line);
  
  // Limit to max lines if specified
  if (maxLines > 0 && lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    
    // Add ellipsis to the last line if it was truncated
    const lastLine = lines[maxLines - 1];
    const metrics = ctx.measureText(lastLine + '...');
    
    if (metrics.width > maxWidth) {
      // Need to truncate the last word to fit with ellipsis
      let lastWords = lastLine.trim().split(' ');
      
      while (lastWords.length > 0) {
        lastWords.pop();
        const truncatedLine = lastWords.join(' ') + '...';
        const truncatedMetrics = ctx.measureText(truncatedLine);
        
        if (truncatedMetrics.width <= maxWidth || lastWords.length === 1) {
          lines[maxLines - 1] = truncatedLine;
          break;
        }
      }
    } else {
      lines[maxLines - 1] = lastLine.trim() + '...';
    }
  }
  
  // Draw all lines
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, y + (i * lineHeight));
  }
  
  return lines.length;
}

/**
 * Generate a social media image for an article
 * @param {Object} article - The article data containing title, excerpt, etc.
 * @returns {Promise<Buffer>} - The generated image as a buffer
 */
export async function generateSocialImage(article) {
  // Ensure fonts and logo exist
  await ensureFontsExist()
  await ensureLogoExists()

  // Canvas dimensions (optimal for social media)
  const width = 1200
  const height = 630

  // Create canvas
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')

  // Get section color mapping - comprehensive list with all your sections
  const sectionColors = {
    // Politics and governance
    politica: '#C93636',
    politics: '#C93636',
    policy: '#C93636',

    // Economy and business
    economia: '#36A336',
    economy: '#36A336',
    business: '#4CAF50',
    dolar: '#4CAF50',
    propiedades: '#4CAF50',
    inmuebles: '#4CAF50',
    campos: '#4CAF50',
    'pymes-emprendimientos': '#4CAF50',

    // Local regions
    'coronel-suarez': '#2980B9',
    'pueblos-alemanes': '#3498DB',
    huanguelen: '#2E86C1',
    'la-sexta': '#21618C',
    'santa-trinidad': '#1B4F72',
    'san-jose': '#1F618D',
    'santa-maria': '#2874A6',

    // Sports and recreation
    deportes: '#3636C9',
    sports: '#3636C9',

    // Culture and arts
    cultura: '#A336A3',
    culture: '#A336A3',
    arts: '#9B59B6',
    vinos: '#8E44AD',
    'el-recetario': '#6C3483',

    // Society and general news
    sociedad: '#F39C12',
    society: '#F39C12',
    efemerides: '#F39C12',
    iactualidad: '#F39C12',
    feriados: '#F39C12',
    'loterias-quinielas': '#F39C12',

    // Health and wellness
    salud: '#27AE60',
    health: '#27AE60',
    'salud-mental': '#2ECC71',
    'vida-armonia': '#2ECC71',
    'nutricion-energia': '#2ECC71',
    fitness: '#2ECC71',

    // Lifestyle and personal
    lifestyle: '#8E44AD',
    'moda-belleza': '#9B59B6',
    mascotas: '#8E44AD',
    horoscopo: '#8E44AD',
    turismo: '#8E44AD',

    // Agriculture and rural
    agro: '#7D9C24',
    agricultura: '#7D9C24',
    ganaderia: '#7D9C24',
    'tecnologias-agro': '#7D9C24',

    // Opinion and editorial
    opinion: '#D35400',
    editorial: '#D35400',

    // Education and knowledge
    educacion: '#3498DB',
    education: '#3498DB',
    ciencia: '#3498DB',

    // Construction and real estate
    'construccion-diseno': '#E67E22',

    // Justice and crime
    policiales: '#E74C3C',

    // Uncategorized
    uncategorized: '#7F8C8D',
    'sin-categoria': '#7F8C8D',

    // Default color if section not found
    default: '#3498DB',
  }

  // Section ID and name
  const sectionId = article.section || 'default'
  const sectionName =
    article.section_name ||
    sectionId.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())

  // Get section color or use default
  const sectionColor = sectionColors[sectionId] || sectionColors.default

  try {
    // Try to load the article image if available
    let bgImage
    try {
      // First try imgUrl if available
      if (article.imgUrl) {
        bgImage = await loadImage(article.imgUrl)
      }
      // Then try image field if it's a JSON string with URL
      else if (article.image && typeof article.image === 'string') {
        try {
          const imageData = JSON.parse(article.image)
          if (imageData[0] && imageData[0].url) {
            bgImage = await loadImage(imageData[0].url)
          }
        } catch (e) {
          console.warn('Failed to parse image JSON:', e)
        }
      }
    } catch (imgError) {
      console.warn('Failed to load article image:', imgError)
    }

    // If we couldn't load the article image, create a color gradient background
    if (!bgImage) {
      // Create gradient background
      const gradient = ctx.createLinearGradient(0, 0, width, height)
      gradient.addColorStop(0, sectionColor)
      gradient.addColorStop(1, '#000000')

      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)
    } else {
      // Draw the background image
      ctx.drawImage(bgImage, 0, 0, width, height)

      // Add dark overlay for better text visibility
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
      ctx.fillRect(0, 0, width, height)
    }

    // Draw section tag (top left)
    const sectionTagHeight = 40
    ctx.fillStyle = sectionColor
    ctx.fillRect(60, 60, 200, sectionTagHeight)

    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 20px Montserrat'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(sectionName.toUpperCase(), 160, 60 + sectionTagHeight / 2)

    // Draw overline (if available)
    let yPosition = 140 // Start position for content

    if (article.overline) {
      ctx.font = 'italic 22px Montserrat'
      ctx.fillStyle = '#EEEEEE'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(article.overline, 60, yPosition)
      yPosition += 40 // Add space after overline
    }

    // Draw title
    ctx.font = 'bold 48px Montserrat'
    ctx.fillStyle = '#FFFFFF'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'

    const titleLineHeight = 60
    const titleLines = drawWrappedText(
      ctx,
      article.title || 'Untitled Article',
      60,
      yPosition,
      width - 120,
      titleLineHeight,
      3 // Max 3 lines for title
    )

    yPosition += titleLines * titleLineHeight + 40 // Add space after title

    // Draw excerpt (if available)
    if (article.excerpt) {
      ctx.font = '24px Montserrat'
      ctx.fillStyle = '#CCCCCC'

      const excerptLineHeight = 32
      drawWrappedText(
        ctx,
        article.excerpt,
        60,
        yPosition,
        width - 120,
        excerptLineHeight,
        4 // Max 4 lines for excerpt
      )
    }

    // Draw logo at bottom right
    try {
      const logo = await loadImage(path.join(imagesDir, 'rdv-logo.png'))
      ctx.drawImage(logo, width - 180, height - 90, 160, 70)
    } catch (logoError) {
      console.warn('Failed to load logo:', logoError)
    }

    // Return the image as a buffer
    return canvas.toBuffer('image/jpeg', { quality: 0.9 })
  } catch (error) {
    console.error('Error generating social image:', error)
    throw error
  }
}

/**
 * Generate platform-specific social media images
 * @param {Object} article - The article data
 * @param {string} platform - The social media platform (instagram, facebook, twitter, tiktok)
 * @returns {Promise<Buffer>} - Image buffer
 */
export async function generatePlatformImage(article, platform = 'facebook') {
  // Ensure fonts and logo exist
  await ensureFontsExist();
  await ensureLogoExists();
  
  // Section details
  const sectionId = article.section || 'default';
  const sectionName = article.section_name || sectionId.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  const sectionColor = sectionColors[sectionId] || sectionColors.default;
  
  // Set platform-specific dimensions
  let width, height, quality;
  
  switch (platform.toLowerCase()) {
    case 'instagram':
      // Square format for Instagram feed
      width = 1080;
      height = 1080;
      quality = 0.95; // Higher quality for Instagram
      break;
    case 'instagram-story':
      // Vertical format for Instagram stories
      width = 1080;
      height = 1920;
      quality = 0.95;
      break;
    case 'tiktok':
      // Vertical format for TikTok
      width = 1080;
      height = 1920;
      quality = 0.92;
      break;
    case 'twitter':
    case 'x':
      // Twitter card format
      width = 1200;
      height = 675;
      quality = 0.9;
      break;
    case 'facebook':
    default:
      // Standard format for Facebook
      width = 1200;
      height = 630;
      quality = 0.9;
      break;
  }
  
  // Create canvas with platform dimensions
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  try {
    // Try to load the article image if available
    let bgImage;
    try {
      // First try imgUrl if available
      if (article.imgUrl) {
        bgImage = await loadImage(article.imgUrl);
      } 
      // Then try image field if it's a JSON string with URL
      else if (article.image && typeof article.image === 'string') {
        try {
          const imageData = JSON.parse(article.image);
          if (imageData[0] && imageData[0].url) {
            bgImage = await loadImage(imageData[0].url);
          }
        } catch (e) {
          console.warn('Failed to parse image JSON:', e);
        }
      }
    } catch (imgError) {
      console.warn('Failed to load article image:', imgError);
    }
    
    if (platform.toLowerCase() === 'instagram') {
      // Instagram-specific stylized design (more artistic)
      if (!bgImage) {
        // Create a gradient background
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, sectionColor);
        gradient.addColorStop(1, '#000000');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      } else {
        // Instagram uses a centered, square crop of the image
        const imgAspect = bgImage.width / bgImage.height;
        let sx, sy, sWidth, sHeight;
        
        if (imgAspect > 1) {
          // Landscape image, crop sides
          sHeight = bgImage.height;
          sWidth = sHeight;
          sx = (bgImage.width - sWidth) / 2;
          sy = 0;
        } else {
          // Portrait image, crop top/bottom
          sWidth = bgImage.width;
          sHeight = sWidth;
          sx = 0;
          sy = (bgImage.height - sHeight) / 3; // Crop more from bottom
        }
        
        ctx.drawImage(bgImage, sx, sy, sWidth, sHeight, 0, 0, width, height);
        
        // Add filter effect for Instagram (slightly warmer tones)
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = 'rgba(255, 235, 215, 0.15)';
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
        
        // Add vignette effect
        const gradient = ctx.createRadialGradient(width/2, height/2, 0, width/2, height/2, width);
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(0.85, 'rgba(0,0,0,0)');
        gradient.addColorStop(1, 'rgba(0,0,0,0.4)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        
        // Add semi-transparent overlay for better text visibility
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(0, 0, width, height);
      }
      
      // Draw a stylish frame for Instagram
      const borderWidth = 40;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 3;
      ctx.strokeRect(borderWidth, borderWidth, width - borderWidth*2, height - borderWidth*2);
      
      // Add section as an angled banner in top left
      ctx.save();
      ctx.translate(80, 80);
      ctx.rotate(-Math.PI / 20); // Slightly rotated
      
      ctx.fillStyle = sectionColor;
      const bannerWidth = 260;
      ctx.fillRect(-10, -25, bannerWidth, 50);
      
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 24px Montserrat';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sectionName.toUpperCase(), bannerWidth/2 - 10, 0);
      ctx.restore();
      
      // Draw title with a more creative layout
      ctx.font = 'bold 56px Montserrat';
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      const titleLines = drawWrappedText(
        ctx, 
        article.title || 'Untitled Article', 
        width/2, 
        height/2 - 40, 
        width - 200, 
        70,
        3 // Max 3 lines
      );
      
      // Draw RDV logo prominently
      try {
        const logo = await loadImage(path.join(imagesDir, 'rdv-logo.png'));
        const logoSize = 150;
        ctx.drawImage(logo, (width - logoSize)/2, height - 220, logoSize, logoSize/2);
      } catch (logoErr) {
        console.warn('Failed to load logo:', logoErr);
      }
    } else if (platform.toLowerCase() === 'tiktok') {
      // TikTok-specific vertical video thumbnail design
      if (!bgImage) {
        // Create a vibrant gradient for TikTok
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, sectionColor);
        gradient.addColorStop(0.5, '#000000');
        gradient.addColorStop(1, sectionColor);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        
        // Add some dynamic lines for TikTok's energetic feel
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 20;
        
        for (let i = 0; i < 10; i++) {
          ctx.beginPath();
          ctx.moveTo(0, i * height/5);
          ctx.lineTo(width, i * height/5 + height/10);
          ctx.stroke();
        }
      } else {
        // Center and crop image for vertical format
        const imgAspect = bgImage.width / bgImage.height;
        let sx, sy, sWidth, sHeight;
        
        if (imgAspect > 9/16) {
          // Landscape image, crop sides heavily
          sHeight = bgImage.height;
          sWidth = sHeight * 9/16;
          sx = (bgImage.width - sWidth) / 2;
          sy = 0;
        } else {
          // Portrait image, use full image
          sWidth = bgImage.width;
          sHeight = bgImage.height;
          sx = 0;
          sy = 0;
        }
        
        ctx.drawImage(bgImage, sx, sy, sWidth, sHeight, 0, 0, width, height);
        
        // Overlay for text visibility
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, width, height);
      }
      
      // Add TikTok-style vertical text block at the bottom
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, height - 400, width, 400);
      
      // Add section in a vibrant badge
      ctx.fillStyle = sectionColor;
      ctx.fillRect((width - 300)/2, height - 460, 300, 60);
      
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 30px Montserrat';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sectionName.toUpperCase(), width/2, height - 430);
      
      // Add title in an attention-grabbing style
      ctx.font = 'bold 54px Montserrat';
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      
      drawWrappedText(
        ctx, 
        article.title || 'Untitled Article', 
        width/2, 
        height - 350, 
        width - 100, 
        60,
        4
      );
      
      // Add play button hint for video content
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.beginPath();
      ctx.arc(width/2, height/2 - 200, 60, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = sectionColor;
      ctx.beginPath();
      ctx.moveTo(width/2 - 20, height/2 - 230);
      ctx.lineTo(width/2 - 20, height/2 - 170);
      ctx.lineTo(width/2 + 30, height/2 - 200);
      ctx.closePath();
      ctx.fill();
      
      // Add RDV logo at the top
      try {
        const logo = await loadImage(path.join(imagesDir, 'rdv-logo.png'));
        ctx.drawImage(logo, (width - 200)/2, 50, 200, 80);
      } catch (logoErr) {
        console.warn('Failed to load logo:', logoErr);
      }
    } else {
      // Standard design for Twitter/Facebook
      if (!bgImage) {
        // Create gradient background
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, sectionColor);
        gradient.addColorStop(1, '#000000');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      } else {
        // Standard layout for Twitter/Facebook
        // Calculate aspect ratio and center crop
        const imgAspect = bgImage.width / bgImage.height;
        const canvasAspect = width / height;
        
        let sw, sh, sx, sy;
        
        if (imgAspect > canvasAspect) {
          // Image is wider than canvas
          sh = bgImage.height;
          sw = sh * canvasAspect;
          sx = (bgImage.width - sw) / 2;
          sy = 0;
        } else {
          // Image is taller than canvas
          sw = bgImage.width;
          sh = sw / canvasAspect;
          sx = 0;
          sy = (bgImage.height - sh) / 2;
        }
        
        // Draw image with proper cropping
        ctx.drawImage(bgImage, sx, sy, sw, sh, 0, 0, width, height);
        
        // Add dark overlay for better text visibility
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, width, height);
      }
      
      // Draw section tag (top left)
      const sectionTagHeight = 40;
      ctx.fillStyle = sectionColor;
      ctx.fillRect(60, 60, 200, sectionTagHeight);
      
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 20px Montserrat';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sectionName.toUpperCase(), 160, 60 + sectionTagHeight/2);
      
      // Draw overline (if available)
      let yPosition = 140; // Start position for content
      
      if (article.overline) {
        ctx.font = 'italic 22px Montserrat';
        ctx.fillStyle = '#EEEEEE';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(article.overline, 60, yPosition);
        yPosition += 40; // Add space after overline
      }
      
      // Draw title
      ctx.font = 'bold 48px Montserrat';
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      
      const titleLineHeight = 60;
      const titleLines = drawWrappedText(
        ctx, 
        article.title || 'Untitled Article', 
        60, 
        yPosition, 
        width - 120, 
        titleLineHeight,
        3 // Max 3 lines for title
      );
      
      yPosition += titleLines * titleLineHeight + 40; // Add space after title
      
      // Draw excerpt (if available)
      if (article.excerpt) {
        ctx.font = '24px Montserrat';
        ctx.fillStyle = '#CCCCCC';
        
        const excerptLineHeight = 32;
        drawWrappedText(
          ctx, 
          article.excerpt, 
          60, 
          yPosition, 
          width - 120, 
          excerptLineHeight,
          4 // Max 4 lines for excerpt
        );
      }
      
      // Draw logo at bottom right
      try {
        const logo = await loadImage(path.join(imagesDir, 'rdv-logo.png'));
        ctx.drawImage(logo, width - 180, height - 90, 160, 70);
      } catch (logoError) {
        console.warn('Failed to load logo:', logoError);
      }
    }
    
    // Return the image as a buffer
    return canvas.toBuffer('image/jpeg', { quality });
  } catch (error) {
    console.error(`Error generating ${platform} image:`, error);
    throw error;
  }
}