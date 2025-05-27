import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import dotenv from 'dotenv'
import publishRoutes from './routes/publish.js'
import webhookRoutes from './routes/webhook.js'
import socialMediaImagesRouter from './routes/social-media-images.js'
import slackRoutes from './routes/slack-integration.js' 


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
app.use(express.urlencoded({ extended: true })) 

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
      slack: '/api/slack',
      health: '/health',
    },
    timestamp: new Date().toISOString(),
  })
})

// Routes
app.use('/api/social-media-images', socialMediaImagesRouter)
app.use('/api/slack', slackRoutes)  // Add this line
app.use('/api', publishRoutes)
app.use('/webhooks', webhookRoutes)


// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Start server for Railway and local development
const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
  console.log(`Environment: ${process.env.NODE_ENV}`)
  console.log(`Platform: Railway`)
})

// Export for Vercel (if needed for other services)
export default app
