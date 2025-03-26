# RDV-NEWS-API

A Node.js application that fetches news from various sources, processes them using Google's Gemini AI, and stores the results in Airtable.

## Features

- Fetch news from RSS feeds
- Extract text content using Readability
- Extract social media embeds (Instagram, Facebook, Twitter, YouTube)
- Process content using Google's Gemini AI
- Generate article metadata (title, summary, etc.)
- Store processed content in Airtable
- Scheduled job execution with cron

## Setup

1. Install dependencies:

npm install

2. Configure environment variables:

- Copy `.env.example` to `.env`
- Add your API keys and configuration

3. Run the application:

npm start

## Architecture

- `src/config`: Configuration management
- `src/services`: Core services (fetching, AI, Airtable, etc.)
- `src/processors`: Content processing logic
- `src/scheduler`: Scheduled jobs
- `src/utils`: Utility functions

## License

MIT

# Understanding Your ETL Architecture

## What You've Built

You've built a sophisticated **ETL (Extract, Transform, Load)** pipeline for news content using:

### 1. Extract Layer

- **RSS Feed** consumption via **axios** to pull article links
- **Web Scraping** with **jsdom** and **@mozilla/readability** to extract content
- **Social Media Embed Extraction** through custom parsers for Instagram, Twitter, Facebook, and YouTube

### 2. Transform Layer

- **AI Processing** with **Google's Gemini AI** to:
  - Generate high-quality metadata (title, volanta, bajada)
  - Rewrite and improve article content
- **Content Structuring** through custom logic that formats and organizes content elements
- **Embed Detection** to identify and format social media content

### 3. Load Layer

- **Airtable API** integration to store processed articles
- Structured data format for consistent storage

### 4. Orchestration

- **Cron Jobs** with **node-cron** for scheduling
- **State Management** for tracking processed articles
- **Logging** for monitoring and debugging

## Connecting to a Database

Your current architecture is **perfectly suited** for expanding to a proper database:

1. **Replace Airtable with a Database**

   - You can simply replace the `airtableService` with a database service
   - The modular architecture means you only need to modify the data layer

2. **Database Options**:

   - **MongoDB**: Great for document-based storage (articles are document-like)
   - **PostgreSQL**: Ideal if you want advanced querying or full-text search
   - **Firebase/Firestore**: Good for real-time capabilities and easy frontend integration

3. **Implementation Example** (MongoDB):

```javascript
// src/services/database.js
const { MongoClient } = require('mongodb')

const uri = process.env.MONGODB_URI
const client = new MongoClient(uri)
const dbName = 'news_api'
const articlesCollection = 'articles'

async function connect() {
  await client.connect()
  console.log('Connected to MongoDB')
  return client.db(dbName)
}

async function insertRecords(records) {
  const db = await connect()
  const collection = db.collection(articlesCollection)

  // Transform Airtable format to MongoDB format
  const documents = records.map((record) => ({
    ...record.fields,
    airtableId: record.id,
    createdAt: new Date(),
  }))

  const result = await collection.insertMany(documents)
  return result
}

async function getRecords() {
  const db = await connect()
  const collection = db.collection(articlesCollection)
  return await collection.find({}).sort({ createdAt: -1 }).toArray()
}

async function getRecord(id) {
  const db = await connect()
  const collection = db.collection(articlesCollection)
  return await collection.findOne({ airtableId: id })
}

module.exports = {
  insertRecords,
  getRecords,
  getRecord,
}
```

## Connecting to a Frontend

Your architecture is also **ideal for integration with frontend frameworks**:

1. **REST API Ready**:

   - You already have Express.js endpoints (`/api/airtable-articles`, `/api/preview/:id`)
   - These can be used directly by any frontend

2. **Structured Data Format**:

   - Your `structureArticleData` function creates frontend-friendly data
   - The content structure (title, volanta, bajada, embeds) maps easily to UI components

3. **Frontend Implementation Options**:

   - **React**: Create components for each content type (volanta, title, embed, etc.)
   - **Vue.js**: Similar component approach with easy bindings
   - **Next.js/Nuxt.js**: Server-side rendering for SEO benefits

4. **Example React Component**:

```jsx
function Article({ article }) {
  return (
    <article className="news-article">
      {article.content.map((section, index) => {
        switch (section.type) {
          case 'volanta':
            return (
              <div key={index} className="volanta">
                {section.content}
              </div>
            )
          case 'title':
            return <h1 key={index}>{section.content}</h1>
          case 'bajada':
            return (
              <div key={index} className="bajada">
                {section.content}
              </div>
            )
          case 'textSection':
            return (
              <div
                key={index}
                className="article-text"
                dangerouslySetInnerHTML={{ __html: marked(section.content) }}
              />
            )
          case 'featuredImage':
            return (
              <img
                key={index}
                src={section.url}
                alt={section.altText}
                className="featured-image"
              />
            )
          case 'embed':
            return (
              <EmbedRenderer
                key={index}
                type={section.embedType}
                content={section.content}
              />
            )
          default:
            return null
        }
      })}
    </article>
  )
}
```

## Why This Architecture Is Powerful

1. **Separation of Concerns**:

   - Each part of your system has a clear, focused responsibility
   - Changing one component doesn't affect others

2. **Modularity**:

   - You can replace or upgrade individual components
   - For example, switch from Gemini AI to OpenAI without changing other parts

3. **Scalability**:

   - The architecture can handle more sources, more articles, or more complex processing
   - You could distribute processing across multiple servers if needed

4. **Extensibility**:
   - Adding new features (like sentiment analysis or categorization) is straightforward

## Next Steps for a Complete System

1. **Database Integration**:

   - Add a proper database instead of relying solely on Airtable
   - Implement caching for frequently accessed articles

2. **API Enhancement**:

   - Add filtering, searching, and pagination to your API endpoints
   - Implement rate limiting and authentication

3. **Frontend Development**:

   - Create a modern web application using React, Vue, or Angular
   - Implement responsive design for mobile and desktop

4. **Advanced Features**:
   - Article recommendations based on content similarity
   - User accounts and preferences
   - Newsletter generation from top articles

This ETL pipeline you've built is not just useful but **essential** for creating a complete news platform with a database and frontend. It handles the complex processes of content acquisition, enrichment, and storage in a way that makes frontend development much more straightforward.
