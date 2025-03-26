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

/**
 * Structures Airtable data into a format suitable for the API
 */

/**
 * Structures article data for API consumption
 * @param {Object} record - Airtable record
 * @returns {Object} - Structured article data
 */
function structureArticleData(record) {
  if (!record || !record.fields) {
    return {
      id: 'unknown',
      title: 'Error: Invalid Article',
      content: [],
      publishDate: new Date().toISOString()
    };
  }
  
  // Extract all the fields from the record
  const {
    title,
    volanta,
    bajada,
    article,
    publishDate,
    imgUrl,
    'ig-post': igPost,
    'fb-post': fbPost,
    'tw-post': twPost,
    'yt-video': ytVideo,
    url: sourceUrl,
    // Extract section-specific fields
    section = 'test',
    sectionId = 'test',
    sectionName = 'Test',
    sectionColor = '#607D8B',
    'article-images': articleImages = '',
    'article-images-data': articleImagesData = '', // New field with structured image data
  } = record.fields;
  
  // Start building the content array
  const content = [];
  
  // Add header content
  if (volanta) {
    content.push({
      type: 'volanta',
      content: volanta
    });
  }
  
  content.push({
    type: 'title',
    content: title || 'No Title'
  });
  
  if (bajada) {
    content.push({
      type: 'bajada',
      content: bajada
    });
  }
  
  // Add featured image
  let featuredImageUrl = '';
  if (imgUrl) {
    featuredImageUrl = imgUrl.split(',')[0].trim();
    content.push({
      type: 'featuredImage',
      url: featuredImageUrl,
      altText: title || 'Featured image',
      caption: ''
    });
  }
  
  // Process main article content
  if (article) {
    content.push({
      type: 'textSection',
      content: article
    });
  }
  
  // Process article images with the enhanced structured data
  const inArticleImages = [];
  try {
    // Parse the structured image data if available
    if (articleImagesData) {
      const imageData = JSON.parse(articleImagesData);
      
      // Filter out low-quality images and ones already used as featured image
      imageData
        .filter(img => 
          img.quality >= 4 && 
          img.url !== featuredImageUrl
        )
        .forEach(img => {
          inArticleImages.push({
            type: 'inArticleImage',
            url: img.url,
            altText: cleanText(img.altText) || title || 'Article image',
            caption: cleanText(img.caption) || '',
            position: img.position || 'after-paragraph-2', // Default position
            quality: img.quality || 5
          });
        });
    }
    // Fallback to legacy images field
    else if (articleImages) {
      const imageUrls = articleImages.split(',').map(url => url.trim());
      const startIndex = imgUrl ? 1 : 0; // Skip first if it's the featured image
      
      for (let i = startIndex; i < Math.min(imageUrls.length, 5); i++) {
        if (imageUrls[i] && imageUrls[i] !== featuredImageUrl) {
          inArticleImages.push({
            type: 'inArticleImage',
            url: imageUrls[i],
            altText: `Image ${i+1}`,
            caption: '',
            position: `after-paragraph-${i*2}`
          });
        }
      }
    }
    
    // Add all valid in-article images to content
    inArticleImages.forEach(img => {
      content.push(img);
    });
  } catch (error) {
    console.error('Error processing article images:', error);
  }
  
  // Add social media embeds
  if (igPost) {
    content.push({
      type: 'embed',
      embedType: 'instagram',
      content: igPost
    });
  }
  
  if (fbPost) {
    content.push({
      type: 'embed',
      embedType: 'facebook',
      content: fbPost
    });
  }
  
  if (twPost) {
    content.push({
      type: 'embed',
      embedType: 'twitter',
      content: twPost
    });
  }
  
  if (ytVideo) {
    content.push({
      type: 'embed',
      embedType: 'youtube',
      content: ytVideo
    });
  }
  
  // Add source attribution
  if (sourceUrl) {
    content.push({
      type: 'sourceAttribution',
      url: sourceUrl,
      text: 'Ver artículo original'
    });
  }
  
  return {
    id: record.id,
    title: title || 'No Title',
    content: content,
    publishDate: publishDate || record.createdTime || new Date().toISOString(),
    section: {
      id: section,
      name: sectionName || 'Unknown Section',
      color: sectionColor || '#607D8B'
    }
  };
}

/**
 * Clean text content by removing markdown and other syntax
 * @param {string} text - Text to clean
 * @returns {string} - Cleaned text
 */
function cleanText(text) {
  if (!text) return '';
  
  return text
    .replace(/!\[.*?\]\(.*?\)/g, '')  // Remove image markdown
    .replace(/\[|\]|\(|\)/g, '')      // Remove brackets and parentheses
    .replace(/https?:\/\/\S+/g, '')   // Remove URLs
    .replace(/\s+/g, ' ')             // Normalize spaces
    .trim();
}

/**
 * Structure section data for API consumption
 * @param {Object} section - Section configuration
 * @returns {Object} - Structured section data
 */
function structureSectionData(section) {
  if (!section) {
    return {
      id: 'unknown',
      name: 'Unknown Section',
      color: '#607D8B',
      articles: []
    };
  }
  
  return {
    id: section.id,
    name: section.name,
    color: section.color || '#607D8B',
    description: section.description || '',
    articles: [] // This will be populated later
  };
}

module.exports = {
  structureArticleData,
  structureSectionData,
  splitArticleIntoSections
};
