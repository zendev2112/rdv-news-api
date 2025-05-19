import { createCanvas } from 'canvas';
import fs from 'fs';
import { execSync } from 'child_process';

// Create a simple test image with text
const canvas = createCanvas(600, 200);
const ctx = canvas.getContext('2d');

// Fill the background
ctx.fillStyle = '#333';
ctx.fillRect(0, 0, 600, 200);

// Test text rendering
ctx.fillStyle = '#fff';
ctx.font = '30px Arial';
ctx.fillText('Testing font rendering', 50, 100);

// Output system font information
console.log('Available fonts:');
try {
  const fonts = execSync('fc-list').toString();
  console.log(fonts.split('\n').slice(0, 10).join('\n') + '...');
} catch (error) {
  console.error('Error listing fonts:', error.message);
}

// Save the test image
const out = fs.createWriteStream('test-font.png');
const stream = canvas.createPNGStream();
stream.pipe(out);
out.on('finish', () => console.log('The PNG file was created.'));