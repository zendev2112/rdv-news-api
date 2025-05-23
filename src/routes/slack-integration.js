import express from 'express'
const slackRoutes = express.Router()

// Test route
slackRoutes.get('/test', (req, res) => {
  res.json({ message: 'Slack integration working!' })
})

slackRoutes.post('/social-task', (req, res) => {
  res.json({
    message: 'received', body:req.body,
  })
})

export default slackRoutes