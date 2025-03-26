const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const app = express();
const port = 3001;

// Airtable configuration
const personalAccessToken = 'patlPzRF8YzZNnogn.0eb9f596eaeaea391004e75e5c3e9e24627f26ae16319fd534b9af8c8b165e66';
const baseId = 'appmc2j8nMRpZM8dV';
const tableName = 'Test';

app.use(cors());
app.use(express.json());
app.use(express.static('.')); // Serve static files from the current directory

// Function to structure article data from an Airtable record
function structureArticleData(record) {
  // Extract all the fields from the record
  const {
    title,
    volanta,
    bajada,
    article,
    imgUrl,
    'ig-post': igPost,
    'fb-post': fbPost,
    'tw-post': twPost,
    'yt-video': ytVideo,
    url: sourceUrl
  } = record.fields;

  // Initialize the structured content array that will hold all article parts in order
  const structuredContent = [];

  // Add volanta if available
  if (volanta) {
    structuredContent.push({
      type: 'volanta',
      content: volanta
    });
  }

  // Add title (required)
  structuredContent.push({
    type: 'title',
    content: title || 'Untitled Article'
  });

  // Add bajada if available
  if (bajada) {
    structuredContent.push({
      type: 'bajada',
      content: bajada
    });
  }

  // Add featured image if available
  if (imgUrl) {
    const images = imgUrl.split(', ').filter(Boolean);
    if (images.length > 0) {
      structuredContent.push({
        type: 'featuredImage',
        url: images[0],
        altText: title || 'Article image',
        caption: ''
      });
    }
  }

  // Add the main article content
  if (article) {
    // Look for natural section breaks to structure the content
    const sections = splitArticleIntoSections(article);
    
    sections.forEach(section => {
      structuredContent.push({
        type: 'textSection',
        content: section
      });
    });
  }
  
  // Add social media embeds in a logical order based on importance/visual impact
  // YouTube videos (highest visual impact)
  if (ytVideo) {
    structuredContent.push({
      type: 'embed',
      embedType: 'youtube',
      content: ytVideo
    });
  }
  
  // Instagram posts
  if (igPost) {
    structuredContent.push({
      type: 'embed',
      embedType: 'instagram',
      content: igPost
    });
  }
  
  // Twitter posts
  if (twPost) {
    structuredContent.push({
      type: 'embed',
      embedType: 'twitter',
      content: twPost
    });
  }
  
  // Facebook posts
  if (fbPost) {
    structuredContent.push({
      type: 'embed',
      embedType: 'facebook',
      content: fbPost
    });
  }
  
  // Add source attribution at the end
  if (sourceUrl) {
    try {
      const hostname = new URL(sourceUrl).hostname;
      structuredContent.push({
        type: 'sourceAttribution',
        url: sourceUrl,
        text: `Source: ${hostname}`
      });
    } catch (e) {
      console.error('Invalid URL:', sourceUrl);
    }
  }
  
  // Create the final structured article object
  return {
    id: record.id,
    title,
    volanta,
    bajada,
    sourceUrl,
    publishDate: new Date().toISOString(),
    content: structuredContent,
    rawFields: record.fields  // Include raw fields for reference
  };
}

// Helper function to split article content into logical sections
function splitArticleIntoSections(article) {
  // Look for markdown headings (##, ###) or multiple consecutive line breaks
  const sectionBreakRegex = /(?:^|\n)#{2,3}\s+[^\n]+|\n{3,}/g;
  
  // If we find section breaks, split by them
  if (sectionBreakRegex.test(article)) {
    return article
      .split(sectionBreakRegex)
      .map(section => section.trim())
      .filter(Boolean);
  }
  
  // If no clear section breaks, look for natural paragraph groupings
  const paragraphs = article.split(/\n{2,}/);
  
  if (paragraphs.length > 6) {
    // Group into sections of approximately 3 paragraphs
    const sections = [];
    for (let i = 0; i < paragraphs.length; i += 3) {
      sections.push(paragraphs.slice(i, i + 3).join('\n\n'));
    }
    return sections;
  }
  
  // If it's not that long, just return the whole thing as one section
  return [article];
}

// Serve the index.html file
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Endpoint to get a list of all records from Airtable
app.get('/api/airtable-articles', async (req, res) => {
  try {
    const response = await axios.get(
      `https://api.airtable.com/v0/${baseId}/${tableName}`,
      {
        headers: {
          Authorization: `Bearer ${personalAccessToken}`
        }
      }
    );
    
    res.json({ records: response.data.records });
  } catch (error) {
    console.error('Error fetching from Airtable:', error);
    res.status(500).json({ error: 'Failed to fetch articles from Airtable' });
  }
});

// Endpoint to get a structured article by ID
app.get('/api/preview/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const response = await axios.get(
      `https://api.airtable.com/v0/${baseId}/${tableName}/${id}`,
      {
        headers: {
          Authorization: `Bearer ${personalAccessToken}`
        }
      }
    );
    
    if (response.data) {
      const structuredArticle = structureArticleData(response.data);
      res.json({ article: structuredArticle });
    } else {
      res.status(404).json({ error: 'Article not found' });
    }
  } catch (error) {
    console.error('Error fetching article:', error);
    res.status(500).json({ error: 'Failed to fetch article' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Article preview server running at http://localhost:${port}`);
});

module.exports = {
  structureArticleData,
  splitArticleIntoSections
};
