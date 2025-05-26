import express from 'express'
import Airtable from 'airtable'
import logger from '../utils/logger.js'

const slackRoutes = express.Router()

// Initialize Airtable using your existing credentials from #.env
const airtable = new Airtable({ apiKey: process.env.AIRTABLE_TOKEN })
const base = airtable.base(process.env.AIRTABLE_BASE_ID)

// Test route
slackRoutes.get('/test', (req, res) => {
  res.json({ message: 'Slack integration working!' })
})

// Debug middleware to see what we're receiving
slackRoutes.use((req, res, next) => {
  console.log('=== SLACK REQUEST DEBUG ===')
  console.log('Headers:', req.headers)
  console.log('Body:', req.body)
  console.log('Raw body type:', typeof req.body)
  console.log('Content-Type:', req.get('Content-Type'))
  console.log('========================')
  next()
})

slackRoutes.post('/social-task', async (req, res) => {
  try {
    console.log('Slack social-task endpoint hit')
    console.log('Full request body:', JSON.stringify(req.body, null, 2))

    // Slack sends these fields in form data
    const {
      token,
      team_id,
      team_domain,
      channel_id,
      channel_name,
      user_id,
      user_name,
      command,
      text,
      response_url,
      trigger_id,
    } = req.body

    // Log what we received
    console.log('Parsed Slack data:', {
      user_name,
      channel_name,
      command,
      text,
      team_domain,
    })

    if (!text || text.trim() === '') {
      return res.json({
        response_type: 'ephemeral',
        text: '❌ Usage: /social-task "Your news headline here"\nExample: /social-task "Breaking: New AI breakthrough announced"',
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

    // Create record in your existing Airtable
    const record = await base('Redes Sociales').create({
      Title: title,
      Status: 'Draft',
      Source: 'Slack',
      'Created By': user_name || 'Unknown',
      Channel: channel_name || 'Unknown',
      'Created Date': new Date().toISOString(),
      Priority: 'Medium',
      Notes: `Created from Slack by ${user_name} in #${channel_name}`,
    })

    console.log(`Created Airtable record ${record.id} from Slack: ${title}`)

    return res.json({
      response_type: 'in_channel',
      text: `📱 Social media task created successfully!`,
      attachments: [
        {
          color: 'good',
          fields: [
            { title: 'Title', value: title, short: false },
            { title: 'Created by', value: user_name || 'Unknown', short: true },
            {
              title: 'Channel',
              value: `#${channel_name || 'unknown'}`,
              short: true,
            },
            { title: 'Record ID', value: record.id, short: true },
            { title: 'Status', value: 'Draft', short: true },
          ],
          actions: [
            {
              type: 'button',
              text: 'View in Airtable',
              url: `https://airtable.com/${process.env.AIRTABLE_BASE_ID}/${record.id}`,
              style: 'primary',
            },
          ],
        },
      ],
    })
  } catch (error) {
    console.error('Error creating social task from Slack:', error)
    return res.json({
      response_type: 'ephemeral',
      text: `❌ Error creating task: ${error.message}`,
    })
  }
})

export default slackRoutes
