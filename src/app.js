import express from 'express';
import { startJobs } from './scheduler/jobs.js';
import logger from './utils/logger.js';
import webhookRoutes from './routes/webhook.js';
import routes from './routes/social-media-images.js';
import { close as closeBrowser } from './services/browser-renderer.js';
import slackRoutes from './routes/slack-integration.js'




// Create Express application
const app = express();

logger.info('Starting RDV-NEWS-API...');

// Configure middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set up routes
app.use('/webhooks', webhookRoutes);
app.use('/api/social-media-images', routes);
app.use('/api/slack', slackRoutes)

// Start the job scheduler
startJobs();

// Ensure the process keeps running
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Add this to your existing shutdown/cleanup handlers
process.on('SIGINT', async () => {
  try {
    await closeBrowser();
    // ... your other cleanup code
  } catch (error) {
    console.error('Error during shutdown:', error);
  } finally {
    process.exit(0);
  }
});

process.on('SIGTERM', async () => {
  try {
    await closeBrowser();
    // ... your other cleanup code
  } catch (error) {
    console.error('Error during shutdown:', error);
  } finally {
    process.exit(0);
  }
});

logger.info('RDV-NEWS-API is running');

export default app;
