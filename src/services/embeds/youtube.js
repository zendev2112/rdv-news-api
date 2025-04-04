import { JSDOM } from 'jsdom';


/**
 * Extracts Youtube embeds from HTML content
 * @param {string} htmlContent - Raw HTML content
 * @returns {string|null} - Youtube embed HTML or null if none found
 */

// Function to extract Twitter embeds from HTML content

function extractYoutubeEmbeds(htmlContent) {
  try {
    const dom = new JSDOM(htmlContent);
    const document = dom.window.document;
    
    // Find YouTube iframes - the most common embed format
    const youtubeIframes = Array.from(
      document.querySelectorAll('iframe[src*="youtube.com/embed"], iframe[src*="youtu.be"]')
    );
    
    // Find YouTube embed divs (some sites use custom containers)
    const youtubeDivs = Array.from(
      document.querySelectorAll(
        'div[class*="youtube"], ' + 
        'div[id*="youtube"], ' + 
        'div.video-container iframe[src*="youtube.com"], ' +
        'div.video-embed iframe[src*="youtube.com"]'
      )
    ).filter(div => {
      // Filter out divs that don't contain actual embeds
      return div.querySelector('iframe[src*="youtube.com"]') || 
             div.getAttribute('data-video-id') ||
             (div.className && div.className.includes('player'));
    });
    
    // Find YouTube links that might need to be converted to embeds
    const youtubeLinks = Array.from(
      document.querySelectorAll('a[href*="youtube.com/watch"], a[href*="youtu.be/"]')
    ).filter(link => {
      // Only consider links that look like video links
      return link.href && (
        link.href.match(/youtube\.com\/watch\?v=([^&]+)/) ||
        link.href.match(/youtu\.be\/([^?&]+)/)
      );
    });
    
    // Process all types of YouTube content
    let youtubeContent = null;
    
    // First priority: iframes (direct embeds)
    if (youtubeIframes.length > 0) {
      // Make sure the iframe has all necessary attributes
      const iframe = youtubeIframes[0];
      
      // Extract the video ID from the src attribute
      let videoId = null;
      const src = iframe.getAttribute('src');
      
      if (src) {
        // Handle YouTube embed URLs
        const embedMatch = src.match(/youtube\.com\/embed\/([^?&]+)/);
        if (embedMatch && embedMatch[1]) {
          videoId = embedMatch[1];
        }
        
        // Handle youtu.be URLs
        const shortMatch = src.match(/youtu\.be\/([^?&]+)/);
        if (!videoId && shortMatch && shortMatch[1]) {
          videoId = shortMatch[1];
        }
      }
      
      // If we found a video ID, create a standardized embed
      if (videoId) {
        youtubeContent = `<iframe width="560" height="315" 
          src="https://www.youtube.com/embed/${videoId}" 
          title="YouTube video player" 
          frameborder="0" 
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
          allowfullscreen></iframe>`;
      } else {
        // Use the original iframe if we couldn't extract the video ID
        youtubeContent = iframe.outerHTML;
      }
      
      console.log("Found YouTube iframe:", youtubeContent.substring(0, 100) + "...");
    } 
    // Second priority: div containers with iframes
    else if (youtubeDivs.length > 0) {
      const div = youtubeDivs[0];
      const iframe = div.querySelector('iframe[src*="youtube.com"]');
      
      if (iframe) {
        // Extract the video ID from the iframe src
        const src = iframe.getAttribute('src');
        let videoId = null;
        
        if (src) {
          const match = src.match(/youtube\.com\/embed\/([^?&]+)/);
          if (match && match[1]) {
            videoId = match[1];
            youtubeContent = `<iframe width="560" height="315" 
              src="https://www.youtube.com/embed/${videoId}" 
              title="YouTube video player" 
              frameborder="0" 
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
              allowfullscreen></iframe>`;
          } else {
            youtubeContent = iframe.outerHTML;
          }
        } else {
          youtubeContent = iframe.outerHTML;
        }
      } else if (div.getAttribute('data-video-id')) {
        // Some sites store the video ID as a data attribute
        const videoId = div.getAttribute('data-video-id');
        youtubeContent = `<iframe width="560" height="315" 
          src="https://www.youtube.com/embed/${videoId}" 
          title="YouTube video player" 
          frameborder="0" 
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
          allowfullscreen></iframe>`;
      } else {
        // Fallback to the whole div if we can't find a better way
        youtubeContent = div.outerHTML;
      }
      
      console.log("Found YouTube div:", youtubeContent.substring(0, 100) + "...");
    } 
    // Third priority: convert links to embed code
    else if (youtubeLinks.length > 0) {
      // Extract the video ID from the URL
      const youtubeUrl = youtubeLinks[0].href;
      let videoId = null;
      
      // Try to match the standard YouTube URL format
      const watchMatch = youtubeUrl.match(/youtube\.com\/watch\?v=([^&]+)/);
      if (watchMatch && watchMatch[1]) {
        videoId = watchMatch[1];
      }
      
      // Try to match the shortened YouTube URL format
      const shortMatch = youtubeUrl.match(/youtu\.be\/([^?&]+)/);
      if (!videoId && shortMatch && shortMatch[1]) {
        videoId = shortMatch[1];
      }
      
      if (videoId) {
        // Create a standard YouTube embed
        youtubeContent = `<iframe width="560" height="315" 
          src="https://www.youtube.com/embed/${videoId}" 
          title="YouTube video player" 
          frameborder="0" 
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
          allowfullscreen></iframe>`;
          
        console.log("Created YouTube embed from link:", youtubeContent);
      }
    }
    
    return youtubeContent;
  } catch (error) {
    console.error('Error extracting YouTube embeds:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    return null;
  }
}

export { extractYoutubeEmbeds };
