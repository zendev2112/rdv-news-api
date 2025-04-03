require('dotenv').config()

const NEWS_SECTIONS = [
  {
    id: 'primera-plana',
    name: 'Primera Plana',
    tableName: 'Primera Plana',
    rssUrl: 'https://rss.app/feeds/v1.1/_on3KHNu40zPeeYkK.json',
    color: '#D32F2F',
    icon: 'gavel',
    priority: 1,
  },
  {
    id: 'instituciones',
    name: 'Instituciones',
    tableName: 'Instituciones',
    rssUrl: 'https://rss.app/feeds/v1.1/_iVEs2ol109NjJyce.json',
    color: '#388E3C',
    icon: 'agriculture',
    priority: 2,
  },
  {
    id: 'agro',
    name: 'Agro',
    tableName: 'Agro',
    rssUrl: 'https://rss.app/feeds/v1.1/_20zJLx8JIZ4cnqkE.json',
    color: '#388E3C',
    icon: 'agriculture',
    priority: 3,
  },
  {
    id: 'deportes',
    name: 'Deportes',
    tableName: 'Deportes',
    rssUrl: 'https://rss.app/feeds/v1.1/_GaWKBBIxuHCE5tH1.json',
    color: '#1976D2',
    icon: 'sports_soccer',
    priority: 4,
  },
  {
    id: 'economia',
    name: 'Economia',
    tableName: 'Economia',
    rssUrl: 'https://rss.app/feeds/v1.1/_ifKDQanGJM3BOKGC.json',
    color: '#FFC107',
    icon: 'attach_money',
    priority: 5,
  },
  {
    id: 'lifestyle',
    name: 'Lifestyle',
    tableName: 'Lifestyle',
    rssUrl: 'https://rss.app/feeds/v1.1/_cnOfvOavDTApWv9j.json',
    color: '#9C27B0',
    icon: 'public',
    priority: 6,
  },
]

const config = {
  port: process.env.PORT || 3001,
  debug: process.env.DEBUG === 'true',

  airtable: {
    personalAccessToken: process.env.AIRTABLE_TOKEN,
    baseId: process.env.AIRTABLE_BASE_ID,
    // Default table is accessed via sections now
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash',
  },

  sections: NEWS_SECTIONS,

  // Find a section by its ID
  getSection(sectionId) {
    return (
      this.sections.find((section) => section.id === sectionId) ||
      this.sections.find((section) => section.id === 'test')
    )
  },

  // Get default section
  getDefaultSection() {
    return this.sections.find((section) => section.id === 'test')
  },
}

module.exports = config
