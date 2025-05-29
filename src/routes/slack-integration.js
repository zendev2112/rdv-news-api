import express from 'express'
import Airtable from 'airtable'

const router = express.Router()

// Initialize Airtable
const base = new Airtable({ apiKey: process.env.AIRTABLE_TOKEN }).base(
  process.env.AIRTABLE_BASE_ID
)

// ULTRA SIMPLE: Just save URL to Airtable
router.post('/simple-add', async (req, res) => {
  try {
    const { text, user_name, channel_name } = req.body

    // Respond immediately to Slack
    res.json({
      response_type: 'in_channel',
      text: `📝 Adding URL to Airtable...`,
    })

    // Create simple record
    const record = await base('Slack Noticias').create({
      url: text.trim(),
      source: 'Manual',
      title: `Article from ${user_name}`,
      article: 'Pending processing',
      status: 'draft',
      tags: 'Manual Entry',
    })

    // Success notification
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel: `#${channel_name}`,
        text: `✅ URL saved to Airtable! Record ID: ${record.id}`,
      }),
    })
  } catch (error) {
    console.error('Error:', error)
    // Error notification
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel: `#${channel_name}`,
        text: `❌ Error: ${error.message}`,
      }),
    })
  }
})

export default router
