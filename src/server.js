import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import dotenv from 'dotenv'
import publishRoutes from './routes/publish.js'
import webhookRoutes from './routes/webhook.js'
import socialMediaImagesRouter from './routes/social-media-images.js'
import slackRoutes from './routes/slack-integration.js' 
import socialMediaPublishingRoutes from './routes/social-media-publishing.js'


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
      /localhost:\d+$/, // Allow any localhost port
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
    ],
    credentials: true,
    optionsSuccessStatus: 200,
  })
)
// ALSO UPDATE the explicit headers middleware:
app.use((req, res, next) => {
  // More explicit CORS headers
  const origin = req.headers.origin
  const allowedOrigins = [
    'https://rdv-image-generator.netlify.app',
    'https://rdv-news-api.vercel.app',
    'http://localhost:3000',
    'http://localhost:5000',
    'http://127.0.0.1:5500',
  ]
  
  if (allowedOrigins.includes(origin) || origin?.includes('netlify.app') || origin?.includes('vercel.app')) {
    res.header('Access-Control-Allow-Origin', origin)
  } else {
    res.header('Access-Control-Allow-Origin', '*')
  }
  
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin')
  res.header('Access-Control-Allow-Credentials', 'true')
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.sendStatus(200)
  } else {
    next()
  }
})
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
      socialPublishing: '/api/social-publishing',
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
app.use('/api/social-publishing', socialMediaPublishingRoutes)


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
