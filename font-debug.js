// font-debug.js
import { createCanvas, registerFont, loadImage } from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Create fonts directory if needed
const fontDir = path.join(__dirname, 'assets/fonts');
if (!fs.existsSync(fontDir)) {
  fs.mkdirSync(fontDir, { recursive: true });
}

// Main test function
async function debugFonts() {
  console.log('Starting font debugging');
  
  // First check and download fonts if necessary
  await setupFonts();
  
  // Create a simple canvas
  const width = 800; 
  const height = 400;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // Fill with light color
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, width, height);
  
  // Test using different fonts
  const fontFamilies = [
    'Arial', 
    'Roboto', 
    'DejaVuSans', 
    'LiberationSans',
    'sans-serif'
  ];
  
  let y = 50;
  const testString = 'Test text with special chars: áéíóú';
  
  // Print available fonts
  console.log('Testing with fonts:');
  fontFamilies.forEach(font => console.log(`- ${font}`));
  
  // Draw with each font
  for (const family of fontFamilies) {
    try {
      console.log(`Drawing with font: ${family}`);
      
      // Debug font metrics
      ctx.font = `24px "${family}"`;
      const metrics = ctx.measureText(testString);
      console.log(`Font metrics for ${family}:`, {
        width: metrics.width,
        height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
      });
      
      // Draw font label
      ctx.fillStyle = '#000000';  
      ctx.fillText(`Font: ${family}`, 20, y);
      
      // Draw actual test string
      ctx.fillStyle = '#0066cc';
      ctx.fillText(testString, 20, y + 30);
      
      y += 70;
    } catch (err) {
      console.error(`Error drawing with font ${family}:`, err);
    }
  }
  
  // Add diagnostic info
  ctx.fillStyle = '#000000';
  ctx.font = '18px sans-serif';
  ctx.fillText(`Node.js: ${process.version}`, 20, height - 70);
  
  // Save the test image
  console.log('Saving test image...');
  const buffer = canvas.toBuffer('image/png');
  const outPath = path.join(__dirname, 'font-debug.png');
  fs.writeFileSync(outPath, buffer);
  console.log(`Test image saved to: ${outPath}`);
  
  // Check fontconfig
  try {
    const { stdout: fcListPath } = await execAsync('which fc-list');
    console.log('fc-list binary found at:', fcListPath.trim());
    
    // Check if fontconfig is working
    const { stdout: fcCacheStatus } = await execAsync('fc-cache -v');
    console.log('Font cache status (first 3 lines):');
    fcCacheStatus.split('\n').slice(0, 3).forEach(line => console.log(line));
    
    // List available system fonts 
    const { stdout: fcList } = await execAsync('fc-list');
    console.log('Available fonts (first 5 lines):');
    fcList.split('\n').slice(0, 5).forEach(line => console.log(line));
  } catch (e) {
    console.error('Error with fontconfig commands:', e.message);
  }
  
  // Check system dependencies
  try {
    const libsToCheck = [
      'libcairo2', 'libpango1.0-0', 'libjpeg8', 'libgif7', 'librsvg2-2', 'fontconfig'
    ];
    
    for (const lib of libsToCheck) {
      try {
        const { stdout } = await execAsync(`dpkg -s ${lib}`);
        console.log(`${lib} status: installed`);
      } catch (e) {
        console.log(`${lib} status: not installed`);
      }
    }
  } catch (e) {
    console.error('Error checking system dependencies:', e.message);
  }
}

// Helper to download and register fonts
async function setupFonts() {
  try {
    // Check if we already have the font
    const robotoRegularPath = path.join(fontDir, 'Roboto-Regular.ttf');
    const robotoBoldPath = path.join(fontDir, 'Roboto-Bold.ttf');
    
    // Download fonts if they don't exist
    if (!fs.existsSync(robotoRegularPath)) {
      console.log('Downloading Roboto Regular font...');
      const regularResponse = await fetch('https://github.com/google/fonts/raw/main/apache/roboto/Roboto-Regular.ttf');
      if (regularResponse.ok) {
        const buffer = await regularResponse.arrayBuffer();
        fs.writeFileSync(robotoRegularPath, Buffer.from(buffer));
        console.log('Roboto Regular font downloaded successfully');
      }
    }
    
    if (!fs.existsSync(robotoBoldPath)) {
      console.log('Downloading Roboto Bold font...');
      const boldResponse = await fetch('https://github.com/google/fonts/raw/main/apache/roboto/Roboto-Bold.ttf');
      if (boldResponse.ok) {
        const buffer = await boldResponse.arrayBuffer();
        fs.writeFileSync(robotoBoldPath, Buffer.from(buffer));
        console.log('Roboto Bold font downloaded successfully');
      }
    }
    
    // Register the fonts
    if (fs.existsSync(robotoRegularPath)) {
      console.log('Registering Roboto Regular font...');
      registerFont(robotoRegularPath, { family: 'Roboto' });
    }
    
    if (fs.existsSync(robotoBoldPath)) {
      console.log('Registering Roboto Bold font...');
      registerFont(robotoBoldPath, { family: 'Roboto', weight: 'bold' });
    }
    
    return true;
  } catch (error) {
    console.error('Error setting up fonts:', error);
    return false;
  }
}

// Run the test
debugFonts().catch(err => console.error('Font debugging failed:', err));
