// filepath: /home/zen/Documents/RDV-NEWS-API/src/app.js
const { startJobs } = require('./scheduler/jobs')
const logger = require('./utils/logger')

logger.info('Starting RDV-NEWS-API...')

// Start the job scheduler
startJobs()

// Ensure the process keeps running
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error)
})

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

logger.info('RDV-NEWS-API is running')
