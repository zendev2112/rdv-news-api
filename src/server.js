import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import dotenv from 'dotenv'
import publishRoutes from './routes/publish.js'
import webhookRoutes from './routes/webhook.js'
import socialMediaImagesRouter from './routes/social-media-images.js'
import slackRoutes from './routes/slack-integration.js'
import socialMediaPublishingRoutes from './routes/social-media-publishing.js'
import configRoutes from './routes/config.js'
import airtableProxyRoutes from './routes/airtable-proxy.js'

// Initialize
dotenv.config()
const app = express()

// Middleware
app.use(
  cors({
    origin: [
      '*', // Allow all origins for development
      'https://rdv-image-generator.netlify.app', // Your frontend domain
      'http://localhost:3000',
      'http://localhost:5000',
      'http://127.0.0.1:5500',
      'https://rdv-news-api.vercel.app',
      /\.netlify\.app$/, // Allow all Netlify apps
      /\.vercel\.app$/, // Allow all Vercel apps
      /\.airtableblocks\.com$/, // Airtable blocks
      /\.airtable\.com$/, // Airtable domain
      /localhost:\d+$/, // Allow any localhost port
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'X-API-Key',
      'x-api-key',
    ],
    credentials: true,
    optionsSuccessStatus: 200,
  })
)

app.use(morgan('dev'))
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb', extended: true }))

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
      socialPublishing: '/api/social-media-publishing',
      slack: '/api/slack',
      health: '/health',
    },
    timestamp: new Date().toISOString(),
  })
})

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  })
})

// Routes
app.use('/api/social-media-images', socialMediaImagesRouter)
app.use('/api/slack', slackRoutes)
app.use('/api', publishRoutes)
app.use('/webhooks', webhookRoutes)
app.use('/api/social-media-publishing', socialMediaPublishingRoutes)
app.use('/api/config', configRoutes)
app.use('/api/airtable-proxy', airtableProxyRoutes)

// Start server for both development AND production
const PORT = process.env.PORT || 3001

if (process.env.NODE_ENV !== 'production') {
  // Local development
  app.listen(PORT, () => {
    console.log(`🚀 Development server running on port ${PORT}`)
    console.log(`Health check: http://localhost:${PORT}/health`)
  })
} else {
  // Production (Render)
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Production server running on port ${PORT}`)
    console.log(`Environment: ${process.env.NODE_ENV}`)
  })
}

// Keep Vercel export for compatibility
export default app
