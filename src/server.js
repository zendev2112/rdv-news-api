import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import dotenv from 'dotenv'
import publishRoutes from './routes/publish.js'
import webhookRoutes from './routes/webhook.js'
import socialMediaImagesRouter from './routes/social-media-images.js'

// Remove or conditionally import background scripts
// import './scripts/poll-sync-requests.js';

// Initialize
dotenv.config()
const app = express()

// Middleware
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
)
app.use(morgan('dev'))
app.use(express.json())

// Root route handler
app.get('/', (req, res) => {
  res.json({
    name: 'RDV News API',
    status: 'online',
    version: '1.0.0',
    endpoints: {
      api: '/api',
      webhooks: '/webhooks',
      socialMediaImages: '/api/social-media-images',
      health: '/health',
    },
    timestamp: new Date().toISOString(),
  })
})

// Routes
app.use('/api', publishRoutes)
app.use('/webhooks', webhookRoutes)
app.use('/api/social-media-images', socialMediaImagesRouter) // Add this line


// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// For local development
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3001
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
  })
}

// Export for Vercel
export default app
