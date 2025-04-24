import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import Airtable from 'airtable';
import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/index.js';
import sharp from 'sharp';

// Configure environment variables
dotenv.config();

// Create __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Airtable
const airtableBase = new Airtable({
  apiKey: process.env.AIRTABLE_TOKEN,
}).base(process.env.AIRTABLE_BASE_ID);

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
const model = genAI.getGenerativeModel({ model: config.gemini.model });

// Create temp directory for image processing (only used if absolutely necessary)
const TEMP_DIR = path.join(__dirname, '../../temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Helper function to create a delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Main function to process social media content
 * @param {Object} options - Processing options
 * @param {string} options.tableName - Name of the Airtable table to process
 * @param {number} options.limit - Maximum number of records to process
 * @param {boolean} options.forceProcess - Process all records regardless of status
 */
async function processSocialMediaContent(options = {}) {
  const {
    tableName = process.env.AIRTABLE_DEFAULT_TABLE || 'Instituciones',
    limit = 20,
    forceProcess = false
  } = options;
  
  console.log(`
================================
SOCIAL MEDIA CONTENT PROCESSOR
================================
Table: ${tableName}
Limit: ${limit} records
Force Processing: ${forceProcess ? 'Yes' : 'No'}
  `);

  try {
    // Fetch records from specified table
    console.log(`Fetching records from "${tableName}" table...`);
    const allRecords = await airtableBase(tableName)
      .select({
        maxRecords: limit,
        sort: [{ field: '_createdTime', direction: 'desc' }],
        filterByFormula: forceProcess 
          ? '' 
          : "OR({processingStatus} = 'needs_extraction', {processingStatus} = '')"
      })
      .all();

    console.log(`Found ${allRecords.length} records in "${tableName}" table`);
    
    if (allRecords.length === 0) {
      console.log('No records to process');
      return { processed: 0, success: 0, failed: 0 };
    }

    // Process statistics
    const stats = {
      processed: 0,
      success: 0,
      failed: 0
    };

    // Process each record
    for (const record of allRecords) {
      try {
        console.log(`\nProcessing record: ${record.id} - "${record.fields.title || 'Untitled'}"`);
        const success = await processRecord(record, tableName);
        
        stats.processed++;
        if (success) {
          stats.success++;
        } else {
          stats.failed++;
        }
        
        // Avoid rate limiting
        await delay(2000);
      } catch (error) {
        console.error(`Error processing record ${record.id}:`, error.message);
        stats.processed++;
        stats.failed++;
      }
    }

    return stats;
  } catch (error) {
    console.error('Error in social media content processing:', error.message);
    return { processed: 0, success: 0, failed: 0, error: error.message };
  }
}

/**
 * Process a single record with social media content
 * @param {Object} record - The Airtable record
 * @param {string} tableName - The table name
 */
async function processRecord(record, tableName) {
  try {
    const fields = record.fields;
    console.log('Available fields:', Object.keys(fields));
    
    // Extract content from different social media sources
    const socialContent = {
      instagram: fields['ig-post'] || null,
      facebook: fields['fb-post'] || null,
      twitter: fields['tw-post'] || null,
      youtube: fields['yt-video'] || null
    };
    
    console.log('Social media sources found:', 
      Object.entries(socialContent)
        .filter(([_, value]) => !!value)
        .map(([key]) => key)
        .join(', ')
    );
    
    // Extract content from each social media source
    let contentPieces = [];
    let source = '';
    
    // Process Instagram
    if (socialContent.instagram) {
      console.log('Processing Instagram content...');
      source = 'Instagram';
      const instagramContent = await extractSocialContent('instagram', socialContent.instagram);
      if (instagramContent) contentPieces.push(instagramContent);
    }
    
    // Process Facebook
    if (socialContent.facebook) {
      console.log('Processing Facebook content...');
      source = source || 'Facebook';
      const facebookContent = await extractSocialContent('facebook', socialContent.facebook);
      if (facebookContent) contentPieces.push(facebookContent);
    }
    
    // Process Twitter
    if (socialContent.twitter) {
      console.log('Processing Twitter content...');
      source = source || 'Twitter';
      const twitterContent = await extractSocialContent('twitter', socialContent.twitter);
      if (twitterContent) contentPieces.push(twitterContent);
    }
    
    // Process YouTube
    if (socialContent.youtube) {
      console.log('Processing YouTube content...');
      source = source || 'YouTube';
      const youtubeContent = await extractSocialContent('youtube', socialContent.youtube);
      if (youtubeContent) contentPieces.push(youtubeContent);
    }
    
    // If no content was extracted, check if we need to process an image
    if (contentPieces.length === 0 && fields.imgUrl) {
      console.log('No text content found, attempting to extract text from image...');
      const imageText = await extractTextFromImageUrl(fields.imgUrl);
      if (imageText) contentPieces.push(imageText);
    }
    
    // Combine all extracted content
    const combinedContent = contentPieces.join('\n\n');
    
    if (!combinedContent) {
      console.log('No content extracted from any source');
      
      // Update using only fields that exist in the table
      await airtableBase(tableName).update(record.id, {
        processingStatus: 'failed',
        processingNotes: 'No content could be extracted from social media sources'
      });
      
      return false;
    }
    
    console.log(`Extracted ${combinedContent.length} characters of content`);
    
    // Generate structured content
    const structuredContent = await generateStructuredContent(combinedContent, fields, source);
    
    // Create update fields object that matches exactly to the table schema
    const updateFields = {
      title: structuredContent.title || fields.title || 'Social Media Content',
      overline: source || fields.overline || 'Social Media',
      excerpt: structuredContent.summary || fields.excerpt || '',
      article: structuredContent.article || combinedContent,
      status: 'Published',
      processingStatus: 'completed'
    };
    
    // Only set section if we have a recommended one and the field exists
    if (structuredContent.recommendedSection) {
      updateFields.section = structuredContent.recommendedSection;
    }
    
    console.log('Updating record with structured content...');
    await airtableBase(tableName).update(record.id, updateFields);
    
    console.log(`Successfully processed record ${record.id}`);
    return true;
  } catch (error) {
    console.error(`Error processing record:`, error.message);
    
    // Update record with error status
    try {
      await airtableBase(tableName).update(record.id, {
        processingStatus: 'error',
        processingNotes: `Error during processing: ${error.message.substring(0, 500)}`
      });
    } catch (e) {
      console.error('Failed to update record error status:', e.message);
    }
    
    return false;
  }
}

/**
 * Extract content from social media source
 * @param {string} platform - Social media platform
 * @param {string} content - URL or content
 */
async function extractSocialContent(platform, content) {
  try {
    // If content is a URL with an image embed
    if (content.match(/\.(jpeg|jpg|png|gif|webp)/i)) {
      return await extractTextFromImageUrl(content);
    }
    
    // For embedded content or plain URLs, we'll use AI to extract useful information
    const prompt = `
      Analyze this ${platform} content and extract all meaningful text:
      
      ${content}
      
      Return ONLY the extracted text content without any analysis or prefacing.
      If this is a URL or embed code with no extractable text, respond with EMPTY.
    `;
    
    const result = await model.generateContent(prompt);
    const extractedText = (await result.response).text().trim();
    
    return extractedText === 'EMPTY' ? '' : extractedText;
  } catch (error) {
    console.error(`Error extracting content from ${platform}:`, error.message);
    return '';
  }
}

/**
 * Extract text from an image URL (without downloading if possible)
 * @param {string} imageUrl - URL of the image
 */
async function extractTextFromImageUrl(imageUrl) {
  try {
    if (!imageUrl) return '';
    
    console.log(`Extracting text from image URL: ${imageUrl}`);
    
    // Option 1: Try to extract without downloading by passing URL directly to AI
    // This works for public images from major platforms
    try {
      console.log('Attempting direct URL analysis without download...');
      
      const prompt = `
        Analyze this image URL and extract all visible text from the image:
        ${imageUrl}
        
        Return ONLY the extracted text with appropriate formatting.
        If you cannot access or analyze this image, respond with CANNOT_ACCESS_IMAGE.
      `;
      
      const result = await model.generateContent(prompt);
      const extractedText = (await result.response).text().trim();
      
      // If successful, return the extracted text
      if (extractedText && extractedText !== 'CANNOT_ACCESS_IMAGE') {
        console.log(`Successfully extracted text directly: ${extractedText.length} characters`);
        return extractedText;
      }
      
      console.log('Direct extraction failed, will attempt download...');
    } catch (e) {
      console.log(`Direct URL extraction failed: ${e.message}`);
    }
    
    // Option 2: If direct URL analysis fails, download and process the image
    // This is used as a fallback and should happen less frequently
    console.log('Downloading image for processing...');
    
    // Create a temporary file path
    const tempFile = path.join(TEMP_DIR, `temp-${Date.now()}.jpg`);
    
    // Download the image
    const response = await axios({
      url: imageUrl,
      method: 'GET',
      responseType: 'arraybuffer',
      timeout: 15000
    });
    
    // Write to temporary file
    fs.writeFileSync(tempFile, response.data);
    
    try {
      // Convert to base64
      const imageBuffer = await sharp(tempFile)
        .resize({ width: 1500, height: 1500, fit: 'inside' })
        .jpeg({ quality: 90 })
        .toBuffer();
      
      const base64Image = imageBuffer.toString('base64');
      
      // Extract text using Gemini API
      const result = await model.generateContent([
        "Extract all visible text from this image. Return ONLY the extracted text.",
        {
          inlineData: {
            data: base64Image,
            mimeType: 'image/jpeg',
          },
        },
      ]);
      
      const extractedText = (await result.response).text().trim();
      console.log(`Extracted ${extractedText.length} characters from downloaded image`);
      
      // Clean up
      fs.unlinkSync(tempFile);
      
      return extractedText;
    } catch (error) {
      console.error('Error extracting text from downloaded image:', error.message);
      
      // Clean up on error
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      
      return '';
    }
  } catch (error) {
    console.error('Image processing error:', error.message);
    return '';
  }
}

/**
 * Generate structured content from raw text
 * @param {string} rawContent - Raw content extracted from social media
 * @param {Object} fields - Original record fields
 * @param {string} source - Source platform name
 */
async function generateStructuredContent(rawContent, fields, source) {
  try {
    // Get existing values to use as context
    const existingTitle = fields.title || '';
    const existingExcerpt = fields.excerpt || '';
    const existingOverline = fields.overline || '';
    
    // Build the prompt
    const prompt = `
      Tengo contenido extraído de ${source} que necesito estructurar para un artículo periodístico:
      
      ${rawContent}
      
      Genera los siguientes elementos para un sitio de noticias:
      
      1. TÍTULO: Un título conciso y atractivo de máximo 12 palabras.
      ${existingTitle ? `Título actual (mejorar si es posible): "${existingTitle}"` : ''}
      
      2. RESUMEN: Un resumen de 40-60 palabras que capture la esencia del contenido.
      ${existingExcerpt ? `Resumen actual (mejorar si es posible): "${existingExcerpt}"` : ''}
      
      3. ARTÍCULO COMPLETO: Un artículo estructurado siguiendo estas pautas:
         - Usa un título claro (no repetir el título principal)
         - Organiza la información en párrafos lógicos y concisos
         - Incluye los puntos clave del contenido original
         - Usa **negritas** para destacar información importante
         - Si hay fechas, horarios o lugares de eventos, destácalos claramente
         - No inventes información que no esté en el contenido original
         - Usa formato markdown adecuado: subtítulos con ##, listas con -, negritas con **
         - Estilo: español rioplatense formal
         
      4. SECCIÓN RECOMENDADA: Considerando el contenido, ¿en qué sección del diario encajaría mejor?
         Opciones: Politica, Economia, Agro
         
      Responde con estos elementos claramente separados por las etiquetas [TÍTULO], [RESUMEN], [ARTÍCULO] y [SECCIÓN], sin incluir estas etiquetas en el contenido.
    `;

    // Generate content
    const result = await model.generateContent(prompt);
    const fullText = (await result.response).text().trim();
    
    // Extract each component
    const titleMatch = fullText.match(/\[TÍTULO\]([\s\S]*?)\[RESUMEN\]/i);
    const summaryMatch = fullText.match(/\[RESUMEN\]([\s\S]*?)\[ARTÍCULO\]/i);
    const articleMatch = fullText.match(/\[ARTÍCULO\]([\s\S]*?)(\[SECCIÓN\]|$)/i);
    const sectionMatch = fullText.match(/\[SECCIÓN\]([\s\S]*?)$/i);
    
    // Extract and format each part
    const title = titleMatch ? titleMatch[1].trim() : existingTitle || 'Contenido de Redes Sociales';
    const summary = summaryMatch ? summaryMatch[1].trim() : existingExcerpt || '';
    
    let article = '';
    if (articleMatch && articleMatch[1].trim()) {
      article = articleMatch[1].trim();
    } else {
      // Default article format if generation fails
      article = `## ${title}\n\n${summary}\n\n${rawContent}\n\n**Fuente:** ${source || 'Redes Sociales'}`;
    }
    
    // Extract recommended section if any
    let recommendedSection = null;
    if (sectionMatch && sectionMatch[1].trim()) {
      const sectionText = sectionMatch[1].trim().toLowerCase();
      
      if (sectionText.includes('polit')) recommendedSection = 'Politica';
      else if (sectionText.includes('econom')) recommendedSection = 'Economia';
      else if (sectionText.includes('agro')) recommendedSection = 'Agro';
    }
    
    return {
      title,
      summary,
      article,
      recommendedSection
    };
  } catch (error) {
    console.error('Error generating structured content:', error.message);
    
    // Return simple formatted content as fallback
    return {
      title: fields.title || 'Contenido de Redes Sociales',
      summary: fields.excerpt || '',
      article: `## ${fields.title || 'Contenido de Redes Sociales'}\n\n${rawContent}\n\n**Fuente:** ${source || 'Redes Sociales'}`
    };
  }
}

// Allow command-line arguments to control behavior
if (import.meta.url === `file://${process.argv[1]}`) {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const options = {
    tableName: args.find(arg => !arg.startsWith('--')) || process.env.AIRTABLE_DEFAULT_TABLE || 'Instituciones',
    limit: parseInt(args.find(arg => arg.startsWith('--limit='))?.split('=')[1] || '20'),
    forceProcess: args.includes('--force')
  };
  
  processSocialMediaContent(options)
    .then(stats => {
      console.log('\n=== Processing Complete ===');
      console.log(`Processed: ${stats.processed} records`);
      console.log(`Successful: ${stats.success} records`);
      console.log(`Failed: ${stats.failed} records`);
      process.exit(0);
    })
    .catch(error => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

export { processSocialMediaContent };
