/**
 * Social Media Publishing Routes
 * Secure backend for RDV Image Generator social media integration
 */

import express from 'express'
import multer from 'multer'
import fetch from 'node-fetch'


const router = express.Router()

// Configure multer for image uploads
const upload = multer({
  limits: {
    fileSize: 50 * 1024 * 1024, // Increase to 50MB
    fieldSize: 50 * 1024 * 1024, // Add field size limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true)
    } else {
      cb(new Error('Only image files are allowed'), false)
    }
  },
})

// Security middleware for social media publishing
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key']
  if (!apiKey || apiKey !== process.env.RDV_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized - Invalid API Key' })
  }
  next()
}

// CORS middleware
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')

  if (req.method === 'OPTIONS') {
    res.sendStatus(200)
  } else {
    next()
  }
})

// Load environment variables with validation
const REQUIRED_SOCIAL_ENV_VARS = [
  'RDV_API_KEY',
  'META_APP_ID',
  'META_APP_SECRET',
  'META_ACCESS_TOKEN',
  'FACEBOOK_PAGE_ID',
  // 'INSTAGRAM_ACCESS_TOKEN',
  // 'INSTAGRAM_ACCOUNT_ID',
  // 'TWITTER_BEARER_TOKEN',
  // 'TWITTER_API_KEY',
  // 'TWITTER_API_SECRET',
  // 'TWITTER_ACCESS_TOKEN',
  // 'TWITTER_ACCESS_TOKEN_SECRET',
]

function validateSocialEnvironment() {
  const missing = REQUIRED_SOCIAL_ENV_VARS.filter((key) => !process.env[key])

  if (missing.length > 0) {
    console.warn('⚠️ Missing social media environment variables:')
    missing.forEach((key) => console.warn(`   - ${key}`))
    console.warn('Social media publishing will use simulation mode')
    return false
  }

  console.log('✅ All social media environment variables loaded')
  return true
}

const SOCIAL_ENV_VALID = validateSocialEnvironment()

// Social Media API configurations
const SOCIAL_CONFIGS = {
  instagram: {
    accessToken:
      process.env.INSTAGRAM_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN,
    accountId: process.env.INSTAGRAM_ACCOUNT_ID,
    apiUrl: 'https://graph.facebook.com/v18.0',
  },
  facebook: {
    accessToken: process.env.META_ACCESS_TOKEN,
    pageId: process.env.FACEBOOK_PAGE_ID,
    apiUrl: 'https://graph.facebook.com/v18.0',
    appId: process.env.META_APP_ID,
    appSecret: process.env.META_APP_SECRET,
  },
  twitter: {
    bearerToken: process.env.TWITTER_BEARER_TOKEN,
    apiKey: process.env.TWITTER_API_KEY,
    apiSecret: process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
    apiUrl: 'https://api.twitter.com/2',
    uploadUrl: 'https://upload.twitter.com/1.1',
  },
}

/**
 * Health check for social media publishing
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'social-media-publishing',
    timestamp: new Date().toISOString(),
    environment_valid: SOCIAL_ENV_VALID,
    platforms_configured: Object.keys(SOCIAL_CONFIGS).length,
    meta_configured: !!(
      process.env.META_APP_ID &&
      process.env.META_ACCESS_TOKEN &&
      process.env.FACEBOOK_PAGE_ID
    ),
  })
})

/**
 * Get available platforms
 */
router.get('/platforms', authenticateApiKey, (req, res) => {
  try {
    const platforms = Object.keys(SOCIAL_CONFIGS).map((platform) => ({
      name: platform,
      available: !!SOCIAL_CONFIGS[platform].accessToken,
      configured: SOCIAL_ENV_VALID,
    }))

    res.json({
      platforms,
      environment_valid: SOCIAL_ENV_VALID,
      total_platforms: platforms.length,
    })
  } catch (error) {
    console.error('Error fetching platforms:', error)
    res.status(500).json({ error: 'Failed to fetch platforms' })
  }
})

/**
 * Test platform connection
 */
router.get('/test/:platform', authenticateApiKey, async (req, res) => {
  try {
    const { platform } = req.params
    const config = SOCIAL_CONFIGS[platform]

    if (!config) {
      return res
        .status(400)
        .json({ error: `Platform ${platform} not supported` })
    }

    if (!SOCIAL_ENV_VALID) {
      return res.json({
        platform,
        status: 'simulation',
        message: 'Environment variables not configured, using simulation mode',
        tested_at: new Date().toISOString(),
      })
    }

    let testResult
    switch (platform) {
      case 'instagram':
        testResult = await testInstagramConnection(config)
        break
      case 'facebook':
        testResult = await testFacebookConnection(config)
        break
      case 'twitter':
        testResult = await testTwitterConnection(config)
        break
      default:
        return res.status(400).json({ error: 'Unsupported platform' })
    }

    res.json(testResult)
  } catch (error) {
    console.error(`Error testing ${req.params.platform}:`, error)
    res.status(500).json({
      error: `Failed to test ${req.params.platform} connection`,
      details: error.message,
      fallback: 'simulation',
    })
  }
})

/**
 * Publish to social media platform
 */
router.post(
  '/publish/:platform',
  authenticateApiKey,
  upload.single('image'),
  async (req, res) => {
    try {
      const { platform } = req.params
      const { caption, metadata } = req.body
      const config = SOCIAL_CONFIGS[platform]

      if (!config) {
        return res
          .status(400)
          .json({ error: `Platform ${platform} not supported` })
      }

      console.log(`📤 Publishing to ${platform}...`)

      // Handle image data
      let imageData = null
      if (req.file) {
        imageData = req.file.buffer
      } else if (req.body.imageBlob) {
        // Base64 image data
        const base64Data = req.body.imageBlob.replace(
          /^data:image\/[a-z]+;base64,/,
          ''
        )
        imageData = Buffer.from(base64Data, 'base64')
      } else {
        return res.status(400).json({ error: 'No image data provided' })
      }

      let result

      // Use real APIs if environment is valid, otherwise simulate
      if (SOCIAL_ENV_VALID) {
        try {
          switch (platform) {
            case 'instagram':
              result = await publishToInstagram(imageData, caption, config)
              break
            case 'facebook':
              result = await publishToFacebook(imageData, caption, config)
              break
            case 'twitter':
              result = await publishToTwitter(imageData, caption, config)
              break
            default:
              return res.status(400).json({ error: 'Unsupported platform' })
          }
        } catch (apiError) {
          console.warn(
            `Real API failed for ${platform}, falling back to simulation:`,
            apiError.message
          )
          result = await simulatePublishing(platform, imageData, caption)
          result.note = 'Real API failed, used simulation'
          result.error_details = apiError.message
        }
      } else {
        result = await simulatePublishing(platform, imageData, caption)
        result.note = 'Environment not configured, used simulation'
      }

      console.log(`✅ Successfully published to ${platform}`)
      res.json(result)
    } catch (error) {
      console.error(`❌ Publishing failed for ${req.params.platform}:`, error)
      res.status(500).json({
        error: `Publishing failed for ${req.params.platform}`,
        details: error.message,
      })
    }
  }
)

// Platform-specific publishing functions

async function publishToInstagram(imageData, caption, config) {
  console.log('📷 Publishing to Instagram via Graph API...')

  try {
    // Step 1: Create media object (upload image)
    const formData = new FormData()
    formData.append('image_url', imageData) // For now, this needs to be a URL
    formData.append('caption', caption)
    formData.append('access_token', config.accessToken)

    // TODO: Implement proper Instagram Business API flow
    // 1. Upload image to temporary location
    // 2. Create media container
    // 3. Publish media container

    // For now, simulate successful Instagram publishing
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const mockId = `ig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    return {
      success: true,
      id: mockId,
      postUrl: `https://www.instagram.com/p/${mockId.slice(-11)}`,
      platform: 'instagram',
      publishedAt: new Date().toISOString(),
      method: 'graph_api_simulation',
      note: 'Instagram Graph API requires image URL - implementing file upload flow',
    }
  } catch (error) {
    console.error('Instagram Graph API error:', error)
    throw new Error(`Instagram publishing failed: ${error.message}`)
  }
}

// Add this function to verify your token
async function debugFacebookToken(config) {
  console.log('🔍 Debugging Facebook access token...')
  
  // Test 1: Check what this token represents
  const tokenResponse = await fetch(`https://graph.facebook.com/me?access_token=${config.accessToken}`)
  const tokenData = await tokenResponse.json()
  console.log('🔑 Token represents:', tokenData)
  
  // Test 2: Check token permissions
  const permissionsResponse = await fetch(`https://graph.facebook.com/me/permissions?access_token=${config.accessToken}`)
  const permissionsData = await permissionsResponse.json()
  console.log('🔐 Token permissions:', permissionsData)
  
  // Test 3: Check if we can access the page
  const pageResponse = await fetch(`https://graph.facebook.com/${config.pageId}?access_token=${config.accessToken}`)
  const pageData = await pageResponse.json()
  console.log('📄 Page access test:', pageData)
  
  return { tokenData, permissionsData, pageData }
}

// Update your publishToFacebook function to include this debug:
async function publishToFacebook(imageData, caption, config) {
  console.log('📘 Publishing to Facebook via Graph API...')
  
  // Add debugging
  try {
    await debugFacebookToken(config)
  } catch (debugError) {
    console.error('🐛 Debug failed:', debugError)
  }
  
  // Continue with your existing upload code...
  try {
    console.log('📤 Uploading image to Facebook...')
    const imageUploadResult = await uploadImageToFacebook(imageData, config)

    // Step 2: Create post with uploaded image
    console.log('📝 Creating Facebook post...')
    const postResult = await createFacebookPost(
      caption,
      imageUploadResult.id,
      config
    )

    return {
      success: true,
      id: postResult.id,
      postUrl: `https://www.facebook.com/${config.pageId}/posts/${postResult.id}`,
      platform: 'facebook',
      publishedAt: new Date().toISOString(),
      method: 'graph_api',
      imageId: imageUploadResult.id,
    }
  } catch (error) {
    console.error('❌ Facebook Graph API detailed error:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    })
    throw error  // Re-throw to see the exact error
  }
}

async function uploadImageToFacebook(imageData, config) {
  console.log('📤 Uploading image via direct POST...')

  let imageBuffer = imageData
  const isJPEG = imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8
  const contentType = isJPEG ? 'image/jpeg' : 'image/png'

  console.log('🖼️ Image details:', {
    size: imageBuffer.length,
    isJPEG,
    contentType,
  })

  // Try the absolute simplest upload method
  const formParams = new URLSearchParams({
    published: 'false',
    access_token: config.accessToken,
  })

  const uploadUrl = `${config.apiUrl}/${config.pageId}/photos`

  const response = await fetch(`${uploadUrl}?${formParams}`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
    },
    body: imageBuffer,
  })

  const result = await response.json()

  console.log('📊 Facebook upload response:', {
    status: response.status,
    ok: response.ok,
    result: result,
  })

  if (!response.ok || result.error) {
    console.error('❌ Facebook upload failed:', result.error)
    throw new Error(
      `Image upload failed: ${result.error?.message || 'Unknown error'}`
    )
  }

  return result
}

async function createFacebookPost(message, photoId, config) {
  // Use URLSearchParams instead of JSON
  const postData = new URLSearchParams({
    message: message,
    attached_media: JSON.stringify([{ media_fbid: photoId }]),
    access_token: config.accessToken,
  })

  const response = await fetch(`${config.apiUrl}/${config.pageId}/feed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: postData.toString(),
  })

  const result = await response.json()

  if (!response.ok || result.error) {
    console.error('❌ Facebook post creation failed:', result.error)
    throw new Error(
      `Post creation failed: ${result.error?.message || 'Unknown error'}`
    )
  }

  if (!result.id) {
    throw new Error('No post ID received from Facebook')
  }

  console.log('✅ Facebook post created:', result.id)
  return result
}

async function publishToTwitter(imageData, caption, config) {
  console.log('🐦 Publishing to Twitter...')

  try {
    // TODO: Implement actual Twitter API v2 calls
    // 1. Upload media using v1.1 API
    // 2. Create tweet with media using v2 API

    // For now, simulate the process
    await new Promise((resolve) => setTimeout(resolve, 2500))

    const mockId = `tw_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    return {
      success: true,
      id: mockId,
      postUrl: `https://twitter.com/radiodelvolga/status/${mockId}`,
      platform: 'twitter',
      publishedAt: new Date().toISOString(),
      method: 'twitter_api_simulation',
      note: 'Twitter API implementation pending',
    }
  } catch (error) {
    console.error('Twitter API error:', error)
    throw new Error(`Twitter publishing failed: ${error.message}`)
  }
}

async function simulatePublishing(platform, imageData, caption) {
  console.log(`🎭 Simulating ${platform} publishing...`)

  // Simulate API delay
  await new Promise((resolve) =>
    setTimeout(resolve, 1000 + Math.random() * 2000)
  )

  // Simulate success/failure (95% success rate)
  const success = Math.random() > 0.05

  if (!success) {
    throw new Error(`Simulación de error en ${platform}`)
  }

  const mockId = `sim_${platform}_${Date.now()}_${Math.random()
    .toString(36)
    .substr(2, 9)}`
  const baseUrls = {
    instagram: 'https://www.instagram.com/p',
    facebook: 'https://www.facebook.com/rdv/posts',
    twitter: 'https://twitter.com/radiodelvolga/status',
  }

  return {
    success: true,
    id: mockId,
    postUrl: `${baseUrls[platform]}/${mockId}`,
    platform: platform,
    publishedAt: new Date().toISOString(),
    method: 'simulation',
    image_size: imageData.length,
    caption_length: caption.length,
  }
}

// Connection test functions

async function testInstagramConnection(config) {
  try {
    const response = await fetch(
      `${config.apiUrl}/${config.accountId}?access_token=${config.accessToken}`
    )

    const data = await response.json()

    if (!response.ok || data.error) {
      throw new Error(data.error?.message || 'Instagram connection failed')
    }

    return {
      platform: 'instagram',
      status: 'connected',
      account_id: config.accountId,
      tested_at: new Date().toISOString(),
    }
  } catch (error) {
    return {
      platform: 'instagram',
      status: 'error',
      error: error.message,
      tested_at: new Date().toISOString(),
    }
  }
}

async function testFacebookConnection(config) {
  try {
    const response = await fetch(
      `${config.apiUrl}/${config.pageId}?fields=id,name,access_token&access_token=${config.accessToken}`
    )

    const data = await response.json()

    if (!response.ok || data.error) {
      throw new Error(data.error?.message || 'Facebook connection failed')
    }

    return {
      platform: 'facebook',
      status: 'connected',
      page_id: data.id,
      page_name: data.name,
      tested_at: new Date().toISOString(),
    }
  } catch (error) {
    return {
      platform: 'facebook',
      status: 'error',
      error: error.message,
      tested_at: new Date().toISOString(),
    }
  }
}

async function testTwitterConnection(config) {
  try {
    const response = await fetch(`${config.apiUrl}/users/me`, {
      headers: {
        Authorization: `Bearer ${config.bearerToken}`,
      },
    })

    const data = await response.json()

    if (!response.ok || data.errors) {
      throw new Error(data.errors?.[0]?.message || 'Twitter connection failed')
    }

    return {
      platform: 'twitter',
      status: 'connected',
      user_id: data.data?.id,
      username: data.data?.username,
      tested_at: new Date().toISOString(),
    }
  } catch (error) {
    return {
      platform: 'twitter',
      status: 'error',
      error: error.message,
      tested_at: new Date().toISOString(),
    }
  }
}

/**
 * Get Facebook page info
 */
router.get('/facebook/page-info', authenticateApiKey, async (req, res) => {
  try {
    const config = SOCIAL_CONFIGS.facebook

    if (!config.accessToken || !config.pageId) {
      return res.status(400).json({ error: 'Facebook not configured' })
    }

    const response = await fetch(
      `${config.apiUrl}/${config.pageId}?fields=id,name,picture,fan_count,access_token&access_token=${config.accessToken}`
    )

    const data = await response.json()

    if (!response.ok || data.error) {
      throw new Error(data.error?.message || 'Failed to get page info')
    }

    res.json({
      success: true,
      page: {
        id: data.id,
        name: data.name,
        picture: data.picture?.data?.url,
        fan_count: data.fan_count,
        has_access_token: !!data.access_token,
      },
      tested_at: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error getting Facebook page info:', error)
    res.status(500).json({
      error: 'Failed to get Facebook page info',
      details: error.message,
    })
  }
})

// Add this middleware for frontend-only access
const authenticateFrontend = (req, res, next) => {
  const origin = req.headers.origin;
  
  // Only allow your specific frontend domain
  if (origin === 'https://rdv-image-generator.netlify.app') {
    next();
  } else {
    res.status(403).json({ error: 'Access denied' });
  }
};

/**
 * Quick publish endpoint for frontend integration
 */
router.post('/quick-publish', authenticateFrontend, async (req, res) => {
  try {
    const { platform, imageBlob, caption, metadata } = req.body

    if (!platform || !imageBlob || !caption) {
      return res.status(400).json({
        error: 'Missing required fields: platform, imageBlob, caption',
      })
    }

    // Convert base64 to buffer
    const base64Data = imageBlob.replace(/^data:image\/[a-z]+;base64,/, '')
    const imageData = Buffer.from(base64Data, 'base64')

    const config = SOCIAL_CONFIGS[platform]
    if (!config) {
      return res
        .status(400)
        .json({ error: `Platform ${platform} not supported` })
    }

    let result

    if (SOCIAL_ENV_VALID) {
      try {
        switch (platform) {
          case 'facebook':
            result = await publishToFacebook(imageData, caption, config)
            break
          case 'instagram':
            result = await publishToInstagram(imageData, caption, config)
            break
          case 'twitter':
            result = await publishToTwitter(imageData, caption, config)
            break
          default:
            return res.status(400).json({ error: 'Unsupported platform' })
        }
      } catch (apiError) {
        console.warn(
          `Real API failed for ${platform}, falling back to simulation:`,
          apiError.message
        )
        result = await simulatePublishing(platform, imageData, caption)
        result.note = 'Real API failed, used simulation'
        result.error_details = apiError.message
      }
    } else {
      result = await simulatePublishing(platform, imageData, caption)
      result.note = 'Environment not configured, used simulation'
    }

    res.json(result)
  } catch (error) {
    console.error('Quick publish error:', error)
    res.status(500).json({
      error: 'Quick publish failed',
      details: error.message,
    })
  }
})

export default router
