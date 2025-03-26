const config = require('./src/config')
const express = require('express')
const cors = require('cors')
const path = require('path')
const app = express()
const port = process.env.PORT || 3001

// Middleware
app.use(cors())
app.use(express.json())
app.use(express.static(__dirname)) // Serve static files from root directory

// API TEST ROUTE - Add this first for debugging
app.get('/api/test', (req, res) => {
  res.json({
    message: 'API is working correctly',
    timestamp: new Date().toISOString(),
    sections: Array.isArray(config.sections) 
      ? config.sections.map(s => s.id)
      : Object.values(config.sections).map(s => s.id)
  });
})

// Import your article preview server functionality
try {
  const { airtableService, structureArticleData } = require('./src/services')

  // Get available sections
  app.get('/api/sections', (req, res) => {
    try {
      // Make sure sections is an array:
      if (!Array.isArray(config.sections)) {
        // If config.sections is not an array, convert it to an array
        const sectionsArray = Object.values(config.sections)
        return res.json(sectionsArray)
      }

      // If it's already an array, return it directly
      return res.json(config.sections)
    } catch (error) {
      console.error('Error fetching sections:', error)
      res.status(500).json({ error: 'Failed to fetch sections' })
    }
  })

  // API endpoint to get all articles from Airtable
  app.get('/api/airtable-articles', async (req, res) => {
    try {
      const records = await airtableService.getRecords()
      res.json({ records })
    } catch (error) {
      console.error('Error fetching articles:', error)
      res.status(500).json({ error: 'Failed to fetch articles' })
    }
  })

  // API endpoint to get articles for a specific section
  app.get('/api/articles/:sectionId', async (req, res) => {
    try {
      const { sectionId } = req.params
      console.log(`Fetching articles for section: ${sectionId}`)
      
      // Validate section
      const section = config.getSection(sectionId)
      if (!section) {
        console.log(`Section not found: ${sectionId}`)
        return res.status(404).json({ error: 'Section not found' })
      }
      
      console.log(`Using table: ${section.tableName}`)
      
      // Get articles from Airtable
      const records = await airtableService.getRecords(sectionId, {
        maxRecords: 20,
        sort: [{ field: 'created', direction: 'desc' }]
      })
      
      console.log(`Retrieved ${records ? records.length : 0} records`)
      
      if (!records || records.length === 0) {
        return res.json([])
      }
      
      // Return basic article info for listings
      const articles = records.map(record => ({
        id: record.id,
        title: record.fields.title || 'No Title',
        bajada: record.fields.bajada || '',
        volanta: record.fields.volanta || '',
        imgUrl: record.fields.imgUrl || ''
      }))
      
      console.log(`Returning ${articles.length} formatted articles`)
      res.json(articles)
    } catch (error) {
      console.error('Error fetching articles:', error)
      res.status(500).json({ error: `Failed to fetch articles: ${error.message}` })
    }
  })

  // API endpoint to get a structured article by ID
  app.get('/api/preview/:id', async (req, res) => {
    try {
      const { id } = req.params
      const record = await airtableService.getRecord(id)

      if (record) {
        const structuredArticle = structureArticleData(record)
        res.json({ article: structuredArticle })
      } else {
        res.status(404).json({ error: 'Article not found' })
      }
    } catch (error) {
      console.error('Error fetching article:', error)
      res.status(500).json({ error: 'Failed to fetch article' })
    }
  })

  // Get articles for a specific section (alternate route)
  app.get('/api/sections/:sectionId/articles', async (req, res) => {
    try {
      const { sectionId } = req.params
      const records = await airtableService.getRecords(sectionId)

      if (records) {
        res.json({ records })
      } else {
        res.status(404).json({ error: 'No articles found for this section' })
      }
    } catch (error) {
      console.error('Error fetching section articles:', error)
      res.status(500).json({ error: 'Failed to fetch articles' })
    }
  })

  // Get a specific article with its section
  app.get('/api/sections/:sectionId/articles/:id', async (req, res) => {
    try {
      const { sectionId, id } = req.params
      const record = await airtableService.getRecord(id, sectionId)

      if (record) {
        const structuredArticle = structureArticleData(record)
        res.json({ article: structuredArticle })
      } else {
        res.status(404).json({ error: 'Article not found' })
      }
    } catch (error) {
      console.error('Error fetching article:', error)
      res.status(500).json({ error: 'Failed to fetch article' })
    }
  })

  // Endpoint to get a specific article
  app.get('/api/article/:sectionId/:articleId', async (req, res) => {
    try {
      const { sectionId, articleId } = req.params
      
      // Validate section
      const section = config.getSection(sectionId)
      if (!section) {
        return res.status(404).json({ error: 'Section not found' })
      }
      
      // Get all records for the section
      const records = await airtableService.getRecords(sectionId)
      if (!records) {
        return res.status(404).json({ error: 'No records found for this section' })
      }
      
      // Find the specific article record
      const record = records.find(r => r.id === articleId)
      if (!record) {
        return res.status(404).json({ error: 'Article not found' })
      }
      
      // Structure the article data for rendering
      const articleData = structureArticleData(record)
      
      // Add section information
      articleData.section = {
        id: sectionId,
        name: section.name,
        color: section.color
      }
      
      res.json(articleData)
    } catch (error) {
      console.error('Error fetching article:', error)
      res.status(500).json({ error: 'Failed to fetch article' })
    }
  })
} catch (error) {
  console.log('Article preview services not available:', error.message)

  // Fallback endpoints
  app.get('/api/airtable-articles', (req, res) => {
    res.json({ records: [] })
  })

  app.get('/api/preview/:id', (req, res) => {
    res.status(404).json({ error: 'Preview service not available' })
  })
}

// Serve the index.html file - THIS MUST COME AFTER ALL API ROUTES
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
})

// Catch-all route - THIS MUST BE THE VERY LAST ROUTE
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
})

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
  console.log(
    `Open http://localhost:${port} in your browser to view the article preview`
  )
})
