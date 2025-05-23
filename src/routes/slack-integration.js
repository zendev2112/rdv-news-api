import express from 'express'
import Airtable from 'airtable'
import logger from '../utils/logger.js'

const router = express.Router()

// Initialize Airtable (using your existing setup)
const airtable = new Airtable({ apiKey: process.env.AIRTABLE_TOKEN })
const base = airtable.base(process.env.AIRTABLE_BASE_ID)

/**
 * Create social media task from Slack
 * Usage: /social-task "Breaking: New AI breakthrough announced"
 */
router.post('/social-task', async (req, res) => {
  try {
    const { text, user_name, channel_name } = req.body

    if (!text || text.trim() === '') {
      return res.json({
        response_type: 'ephemeral',
        text: '❌ Usage: /social-task "Your news headline here"',
      })
    }

    // Clean up the text
    const title = text.replace(/^["']|["']$/g, '').trim()

    if (title.length < 5) {
      return res.json({
        response_type: 'ephemeral',
        text: '❌ Title must be at least 5 characters long',
      })
    }

    // Create record in your existing "Redes Sociales" table
    const record = await base('Redes Sociales').create({
      Title: title,
      Status: 'Draft',
      Source: 'Slack',
      'Created By': user_name,
      Channel: channel_name,
      'Created Date': new Date().toISOString(),
      Priority: 'Medium',
    })

    logger.info(`Created Airtable record ${record.id} from Slack: ${title}`)

    // Generate the URL for your existing image generation
    const generateUrl = `${
      process.env.SERVER_URL || 'http://localhost:3000'
    }/api/social-media-images/airtable-generate?recordId=${
      record.id
    }&title=${encodeURIComponent(title)}&platform=facebook`

    return res.json({
      response_type: 'in_channel',
      text: `📱 Social media task created!`,
      attachments: [
        {
          color: 'good',
          fields: [
            { title: 'Title', value: title, short: false },
            { title: 'Created by', value: user_name, short: true },
            { title: 'Record ID', value: record.id, short: true },
          ],
          actions: [
            {
              type: 'button',
              text: 'Generate Images',
              url: generateUrl,
              style: 'primary',
            },
          ],
        },
      ],
    })
  } catch (error) {
    logger.error('Error creating social task from Slack:', error)
    return res.json({
      response_type: 'ephemeral',
      text: `❌ Error: ${error.message}`,
    })
  }
})

export default router
