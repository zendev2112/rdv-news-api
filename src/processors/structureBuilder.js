const logger = require('../utils/logger');

// Regular expression for markdown images
const markdownImageRegex = /!\[(.*?)\]\((.*?)(?:\s+"(.*?)")?\)/g;

/**
 * Extracts images from article content and maintains their position
 * @param {string} article - Article content
 * @returns {Array} - Array of article sections and image objects in order
 */
function extractContentWithImages(article) {
  if (!article) return [];
  
  const contentElements = [];
  
  // Process the article content
  let lastIndex = 0;
  let match;
  
  // Extract markdown images and surrounding text
  while ((match = markdownImageRegex.exec(article)) !== null) {
    // Add text before the image if any
    if (match.index > lastIndex) {
      const textSection = article.substring(lastIndex, match.index).trim();
      if (textSection) {
        contentElements.push({
          type: 'text',
          content: textSection
        });
      }
    }
    
    // Add the image
    contentElements.push({
      type: 'image',
      url: match[2],                    // Image URL
      altText: match[1] || '',          // Alt text
      caption: match[3] || ''           // Caption
    });
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add any remaining text after the last image
  if (lastIndex < article.length) {
    const textSection = article.substring(lastIndex).trim();
    if (textSection) {
      contentElements.push({
        type: 'text',
        content: textSection
      });
    }
  }
  
  // If no images were found, fall back to regular text processing
  if (contentElements.length === 0) {
    return splitArticleIntoSections(article).map(section => ({
      type: 'text',
      content: section
    }));
  }
  
  return contentElements;
}

/**
 * Splits article content into logical sections
 * @param {string} article - Article content
 * @returns {Array} - Array of article sections
 */
function splitArticleIntoSections(article) {
  if (!article) return [];
  
  // Look for markdown headings or multiple consecutive line breaks
  const sectionBreakRegex = /(?:^|\n)#{2,3}\s+[^\n]+|\n{3,}/g;

  // If we find section breaks, split by them
  if (sectionBreakRegex.test(article)) {
    return article
      .split(sectionBreakRegex)
      .map((section) => section.trim())
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

/**
 * Structures article data into a cohesive format
 * @param {Object} record - Airtable record
 * @returns {Object} - Structured article
 */
function structureArticleData(record) {
  if (!record || !record.fields) {
    logger.error('Invalid record provided to structureArticleData');
    return {
      id: 'unknown',
      title: 'Error: Invalid Article',
      content: [],
      publishDate: new Date().toISOString()
    };
  }
  
  // Extract fields
  const {
    title,
    volanta,
    bajada,
    article,
    imgUrl,
    'article-images': articleImages = '',
    'ig-post': igPost,
    'fb-post': fbPost,
    'tw-post': twPost,
    'yt-video': ytVideo,
    url: sourceUrl,
    // Extract section fields with defaults
    sectionId = 'news',
    sectionName = 'News',
    sectionColor = '#1976D2'
  } = record.fields;

  // Structure content
  const structuredContent = [];

  // Add volanta if available
  if (volanta) {
    structuredContent.push({
      type: 'volanta',
      content: volanta,
    });
  }

  // Add title
  structuredContent.push({
    type: 'title',
    content: title || 'Untitled Article',
  });

  // Add bajada if available
  if (bajada) {
    structuredContent.push({
      type: 'bajada',
      content: bajada,
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
        caption: '',
      });
    }
  }

  // Process article content with embedded images
  if (article) {
    // Extract content elements with properly positioned images
    const contentElements = extractContentWithImages(article);
    
    // Add each content element to the structured content
    contentElements.forEach((element) => {
      if (element.type === 'text') {
        structuredContent.push({
          type: 'textSection',
          content: element.content,
        });
      } else if (element.type === 'image') {
        structuredContent.push({
          type: 'inArticleImage',
          url: element.url,
          altText: element.altText || title || 'Article image',
          caption: element.caption || '',
        });
      }
    });
  }

  // Add social media embeds in a logical order
  if (ytVideo) {
    structuredContent.push({
      type: 'embed',
      embedType: 'youtube',
      content: ytVideo,
    });
  }

  if (twPost) {
    structuredContent.push({
      type: 'embed',
      embedType: 'twitter',
      content: twPost,
    });
  }

  if (igPost) {
    structuredContent.push({
      type: 'embed',
      embedType: 'instagram',
      content: igPost,
    });
  }

  if (fbPost) {
    structuredContent.push({
      type: 'embed',
      embedType: 'facebook',
      content: fbPost,
    });
  }

  // Add source attribution
  if (sourceUrl) {
    try {
      const hostname = new URL(sourceUrl).hostname;
      structuredContent.push({
        type: 'sourceAttribution',
        url: sourceUrl,
        text: `Source: ${hostname}`,
      });
    } catch (e) {
      logger.error(`Invalid URL: ${sourceUrl}`);
    }
  }

  // Create final structure
  return {
    id: record.id || 'unknown',
    title,
    volanta,
    bajada,
    sourceUrl,
    publishDate: new Date().toISOString(),
    content: structuredContent,
    // Include section information
    section: {
      id: sectionId,
      name: sectionName,
      color: sectionColor
    },
    rawFields: record.fields,
  };
}

module.exports = {
  structureArticleData,
  splitArticleIntoSections,
  extractContentWithImages
};
