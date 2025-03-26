const logger = require('./logger');

/**
 * Find the main content area of an article
 * @param {Document} document - JSDOM document
 * @returns {HTMLElement|null} - Main content element or null
 */
function findMainContentArea(document) {
  // Common selectors for main content areas
  const contentSelectors = [
    'article', 
    '.article-content', 
    '.article-body', 
    '.post-content',
    '.entry-content',
    '[itemprop="articleBody"]',
    '.story-content',
    'main',
    '#main-content',
    '.post',
    '.content'
  ];
  
  for (const selector of contentSelectors) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        logger.debug(`Found main content area with selector: ${selector}`);
        return element;
      }
    } catch (e) {
      // Ignore errors for selectors that don't exist
    }
  }
  
  logger.debug('No main content area found, using document body');
  return document.body;
}

/**
 * Clean up the document by removing unwanted elements
 * @param {Document} document - JSDOM document
 */
function cleanupDocument(document) {
  // Remove script tags
  const scripts = document.querySelectorAll('script');
  scripts.forEach(script => script.remove());
  
  // Remove style tags
  const styles = document.querySelectorAll('style');
  styles.forEach(style => style.remove());
  
  // Elements to remove by selector
  const unwantedSelectors = [
    'header:not(article header)', 
    'footer:not(article footer)', 
    'nav', 
    '.nav', 
    '.navigation', 
    '.menu',
    '.sidebar', 
    '.aside', 
    '.ads', 
    '.ad-container', 
    '.social-share',
    '.related-articles', 
    '.comments', 
    '#comments',
    '[class*="ad-"]', 
    '[id*="ad-"]', 
    '[class*="banner"]',
    'aside', 
    '.widget', 
    '.popup', 
    '.modal',
    '.newsletter',
    '.subscription',
    '.cookie-notice'
  ];
  
  unwantedSelectors.forEach(selector => {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        logger.debug(`Removing element: ${selector}`);
        el.remove();
      });
    } catch (e) {
      // Just ignore errors for selectors that don't exist
    }
  });
}

/**
 * Extract high-quality text from HTML elements
 * @param {HTMLElement} element - Element to extract text from
 * @returns {string} - Clean article text
 */
function extractArticleText(element) {
  if (!element) return '';
  
  // Find all paragraph elements
  const paragraphs = element.querySelectorAll('p');
  let text = '';
  
  // Process paragraphs
  if (paragraphs.length > 0) {
    text = Array.from(paragraphs)
      .map(p => p.textContent.trim())
      .filter(p => p.length > 20) // Skip very short paragraphs
      .join('\n\n');
  } else {
    // Fallback: get all text and try to structure it
    text = element.textContent
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\. /g, '.\n\n'); // Try to break by sentences
  }
  
  // Clean up the text
  return cleanupArticleText(text);
}

/**
 * Clean up article text to remove URLs and other noise
 * @param {string} text - Raw article text
 * @returns {string} - Cleaned text
 */
function cleanupArticleText(text) {
  return text
    // Remove URLs
    .replace(/https?:\/\/\S+/g, '')
    // Remove image references
    .replace(/!\[.*?\]\(.*?\)/g, '')
    // Remove markdown links
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')
    // Remove excess whitespace
    .replace(/\s+/g, ' ')
    // Clean up any dangling brackets
    .replace(/\[\s*\]/g, '')
    // Split into proper paragraphs
    .split(/\.\s+/)
    .map(p => p.trim())
    .filter(p => p.length > 20) // Skip very short fragments
    .join('.\n\n')
    .trim();
}

/**
 * Extract metadata from the document
 * @param {Document} document - JSDOM document
 * @param {Object} item - Original item with URL and title
 * @returns {Object} - Extracted metadata
 */
function extractMetadata(document, item) {
  // Initialize with fallback values
  const metadata = {
    title: item.title || '',
    bajada: '',
    volanta: '',
    publishDate: ''
  };

  try {
    // Title - try various methods
    const metaTitle = document.querySelector('meta[property="og:title"]') || 
                     document.querySelector('meta[name="twitter:title"]');
    
    if (metaTitle && metaTitle.getAttribute('content')) {
      metadata.title = metaTitle.getAttribute('content').trim();
    } else {
      const h1 = document.querySelector('h1');
      if (h1) metadata.title = h1.textContent.trim();
    }
    
    // Description/Bajada
    const metaDesc = document.querySelector('meta[property="og:description"]') || 
                    document.querySelector('meta[name="description"]') ||
                    document.querySelector('meta[name="twitter:description"]');
    
    if (metaDesc && metaDesc.getAttribute('content')) {
      metadata.bajada = metaDesc.getAttribute('content').trim();
    }
    
    // Try to extract volanta (category/section)
    const categoryElements = [
      document.querySelector('.category'),
      document.querySelector('.section'),
      document.querySelector('[rel="category"]'),
      document.querySelector('.article-section'),
      document.querySelector('.article-category')
    ].filter(Boolean);
    
    if (categoryElements.length > 0) {
      metadata.volanta = categoryElements[0].textContent.trim();
    }
    
    // Publication date
    const metaDate = document.querySelector('meta[property="article:published_time"]') || 
                     document.querySelector('time[datetime]');
    
    if (metaDate) {
      const dateStr = metaDate.getAttribute('content') || metaDate.getAttribute('datetime');
      if (dateStr) {
        try {
          const date = new Date(dateStr);
          metadata.publishDate = date.toISOString();
        } catch (e) {
          logger.debug(`Error parsing date: ${dateStr}`);
        }
      }
    }
  } catch (error) {
    logger.error(`Error extracting metadata: ${error.message}`);
  }
  
  return metadata;
}

/**
 * Extract social media embeds from the document
 * @param {Document} document - JSDOM document
 * @returns {Object} - Extracted social embeds
 */
function extractSocialEmbeds(document) {
  const embeds = {
    twitter: '',
    facebook: '',
    instagram: '',
    youtube: ''
  };
  
  try {
    // Twitter embeds
    const twitterEmbed = document.querySelector('.twitter-tweet, [data-tweet-id], blockquote[class*="twitter"]');
    if (twitterEmbed) {
      embeds.twitter = twitterEmbed.outerHTML;
    }
    
    // Facebook embeds
    const facebookEmbed = document.querySelector('.fb-post, [data-href*="facebook"], iframe[src*="facebook"]');
    if (facebookEmbed) {
      embeds.facebook = facebookEmbed.outerHTML;
    }
    
    // Instagram embeds
    const instagramEmbed = document.querySelector('.instagram-media, blockquote[class*="instagram"], iframe[src*="instagram"]');
    if (instagramEmbed) {
      embeds.instagram = instagramEmbed.outerHTML;
    }
    
    // YouTube embeds
    const youtubeEmbed = document.querySelector('iframe[src*="youtube"], iframe[src*="youtu.be"]');
    if (youtubeEmbed) {
      embeds.youtube = youtubeEmbed.outerHTML;
    }
  } catch (e) {
    logger.error('Error extracting social embeds:', e.message);
  }
  
  return embeds;
}

module.exports = {
  findMainContentArea,
  cleanupDocument,
  extractArticleText,
  cleanupArticleText,
  extractMetadata,
  extractSocialEmbeds
};