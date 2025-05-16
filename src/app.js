import express from 'express';
import { startJobs } from './scheduler/jobs.js';
import logger from './utils/logger.js';
import webhookRoutes from './routes/webhook.js';
import socialMediaImagesRouter from './routes/social-media-images.js';

// Create Express application
const app = express();

logger.info('Starting RDV-NEWS-API...');

// Configure middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set up routes
app.use('/webhooks', webhookRoutes);
app.use('/api/social-media-images', socialMediaImagesRouter);

// Start the job scheduler
startJobs();

// Ensure the process keeps running
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

logger.info('RDV-NEWS-API is running');

export default app;
