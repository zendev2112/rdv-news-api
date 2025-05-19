// test-text-rendering.js
import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import textRenderer from './src/services/text-renderer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testTextRendering() {
  console.log('Starting text rendering test...');
  
  // Create canvas
  const width = 800;
  const height = 600;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // Fill with gradient background
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#1a2a6c');
  gradient.addColorStop(0.5, '#b21f1f');
  gradient.addColorStop(1, '#fdbb2d');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  
  // Add title
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = `bold 36px ${textRenderer.getBestAvailableFont()}`;
  ctx.fillText('Text Rendering Test', width / 2, 50);
  
  // Draw a border
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.strokeRect(20, 20, width - 40, height - 40);
  
  // Test different languages and characters
  const testTexts = [
    { text: 'English: Hello World!', y: 130 },
    { text: 'Spanish: ¡Hola Mundo! ñ á é í ó ú', y: 170 },
    { text: 'French: Bonjour le Monde! ç è é ê ë', y: 210 },
    { text: 'German: Hallo Welt! ä ö ü ß', y: 250 },
    { text: 'Russian: Привет мир!', y: 290 },
    { text: 'Greek: Γειά σου Κόσμε!', y: 330 },
    { text: 'Japanese: こんにちは世界！', y: 370 },
    { text: 'Chinese: 你好，世界！', y: 410 },
    { text: 'Emoji: 👋 🌍 🎉 🚀 🐱', y: 450 },
    { text: 'Symbols: ★ ☆ ♠ ♣ ♥ ♦ ♪ ♫ €', y: 490 }
  ];
  
  // Draw each text twice - once with direct canvas text and once with our renderer
  testTexts.forEach(({ text, y }) => {
    // Left side - direct canvas text
    ctx.save();
    ctx.textAlign = 'left';
    ctx.font = `24px ${textRenderer.getBestAvailableFont()}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Canvas: ' + text, 40, y);
    ctx.restore();
    
    // Right side - our text renderer with fallback
    textRenderer.drawText(ctx, 'Renderer: ' + text, width - 40, y, {
      fontSize: 24,
      fontWeight: 'normal',
      color: '#ffcc00',
      textAlign: 'right',
      testMode: true // Draw red box around text for visibility
    });
  });
  
  // Add timestamp and info
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.font = '14px sans-serif';
  ctx.fillText(`Generated: ${new Date().toISOString()}`, 40, height - 60);
  ctx.fillText(`Best font: ${textRenderer.getBestAvailableFont()}`, 40, height - 40);
  
  // Save the image
  const buffer = canvas.toBuffer('image/png');
  const outputPath = path.join(__dirname, 'text-rendering-test.png');
  fs.writeFileSync(outputPath, buffer);
  
  console.log(`Image saved to: ${outputPath}`);
  console.log('Test completed successfully!');
}

// Run the test
testTextRendering().catch(err => console.error('Test failed:', err));
