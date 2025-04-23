import cron from 'node-cron';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();
const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '../../');

console.log('Starting content scheduler...');

// Check Airtable connection - runs every 6 hours
cron.schedule('0 */6 * * *', async () => {
  try {
    console.log('Running scheduled Airtable connection check');
    await execAsync('npm run check-airtable', { cwd: rootDir });
    console.log('Airtable connection check completed');
  } catch (error) {
    console.error('Airtable connection check failed:', error.stdout || error.message);
  }
});

// Fetch content from all sections - runs every 3 hours
cron.schedule('0 */3 * * *', async () => {
  try {
    console.log('Running scheduled content fetch for all sections');
    await execAsync('npm run fetch:all', { cwd: rootDir });
    console.log('Content fetch completed');
  } catch (error) {
    console.error('Content fetch failed:', error.stdout || error.message);
  }
});

// Fetch social media content - runs every 4 hours
cron.schedule('0 */4 * * *', async () => {
  try {
    console.log('Running scheduled social media fetch');
    await execAsync('npm run fetch:instituciones', { cwd: rootDir });
    console.log('Social media fetch completed');
  } catch (error) {
    console.error('Social media fetch failed:', error.stdout || error.message);
  }
});

// Process social media content - runs 15 minutes after social media fetch
cron.schedule('15 */4 * * *', async () => {
  try {
    console.log('Running scheduled social media processing');
    await execAsync('npm run process:social', { cwd: rootDir });
    console.log('Social media processing completed');
  } catch (error) {
    console.error('Social media processing failed:', error.stdout || error.message);
  }
});

// Sync Primera Plana articles - runs every 2 hours
cron.schedule('0 */2 * * *', async () => {
  try {
    console.log('Running scheduled Primera Plana sync');
    await execAsync('npm run sync:primera-plana', { cwd: rootDir });
    console.log('Primera Plana sync completed');
  } catch (error) {
    console.error('Primera Plana sync failed:', error.stdout || error.message);
  }
});

console.log('Scheduler initialized with all tasks');
