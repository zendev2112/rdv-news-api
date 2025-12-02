import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import Airtable from 'airtable'
import { GoogleGenerativeAI } from '@google/generative-ai'
import axios from 'axios'  // Add axios for image downloading
import config from '../config/index.js'

// Configure environment variables
dotenv.config()

// Create __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Initialize Airtable
const airtableBase = new Airtable({
  apiKey: process.env.AIRTABLE_TOKEN,
}).base(process.env.AIRTABLE_BASE_ID)

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(config.gemini.apiKey)
const model = genAI.getGenerativeModel({ model: config.gemini.model })
const visionModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }) // Add vision model

// Helper function to create a delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Main function to process social media content
 */
async function processSocialMediaContent(options = {}) {
  const {
    tableName = 'Instituciones',
    limit = 20,
    forceProcess = false,
  } = options

  console.log(`
================================
SOCIAL MEDIA CONTENT PROCESSOR
================================
Table: ${tableName}
Limit: ${limit} records
Force Processing: ${forceProcess ? 'Yes' : 'No'}
  `)

  try {
    // IMPROVED: Include records that need OCR in the filter formula 
    let filterFormula = forceProcess 
      ? "" 
      : "OR({processingStatus} = 'needs_extraction', {isOcrNeeded} = 1)";
    
    console.log(`Fetching records from "${tableName}" with filter: ${filterFormula || 'ALL RECORDS'}`);

    // Get records from Airtable
    const records = await airtableBase(tableName)
      .select({
        maxRecords: limit,
        filterByFormula: filterFormula
      })
      .all();

    console.log(`Found ${records.length} records to process`);

    // If no records found, check if table has any records
    if (records.length === 0) {
      console.log("No records match the criteria. Checking if table has any records...");
      
      const checkRecords = await airtableBase(tableName)
        .select({ maxRecords: 5 })
        .all();
      
      if (checkRecords.length > 0) {
        console.log(`Table contains records but none match the filter criteria.`);
        console.log(`Try running with --force to process all records.`);
      } else {
        console.log(`Table "${tableName}" appears to be empty.`);
      }
      
      return { processed: 0, success: 0, failed: 0 };
    }

    // Process statistics
    const stats = {
      processed: 0,
      success: 0,
      failed: 0
    };

    // Process each record
    for (const record of records) {
      try {
        console.log(`\nProcessing record: ${record.id} - ${record.fields.title || 'Untitled'}`);
        
        const result = await processRecord(record, tableName);
        stats.processed++;
        
        if (result) {
          stats.success++;
          console.log(`Successfully processed record ${record.id}`);
        } else {
          stats.failed++;
          console.log(`Failed to process record ${record.id}`);
        }
        
        // Add delay to avoid rate limiting
        await delay(1000);
      } catch (error) {
        console.error(`Error processing record ${record.id}:`, error);
        stats.processed++;
        stats.failed++;
      }
    }

    return stats;
  } catch (error) {
    console.error('Error in social media processing:', error);
    return { processed: 0, success: 0, failed: 0, error: error.message };
  }
}

/**
 * Process a single record
 */
async function processRecord(record, tableName) {
  try {
    const fields = record.fields;
    console.log(`Processing record ${record.id}`);
    
    // Check if OCR is needed for this record
    const needsOcr = fields.isOcrNeeded === true;
    
    if (needsOcr) {
      console.log('Record is marked for OCR processing');
    }
    
    // Update processing status
    try {
      await airtableBase(tableName).update(record.id, {
        processingStatus: 'needs_extraction',
        processingNotes: needsOcr ? 'Starting OCR and content generation' : 'Starting content generation'
      });
    } catch (updateErr) {
      console.error(`Couldn't update processing status: ${updateErr.message}`);
    }
    
    // Get content from article or contentHtml (prioritize article)
    let rawContent = '';
    
    if (fields.article && fields.article.trim()) {
      console.log('Using existing article content');
      rawContent = fields.article;
    }
    else if (fields.contentHtml) {
      console.log('Extracting text from HTML content');
      // Simple HTML to text conversion
      rawContent = fields.contentHtml
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    
    // If no content was found, try to get it from social fields
    if (!rawContent) {
      console.log('No article or HTML content found, checking social media fields');
      
      // Check all social media fields
      const socialFields = ['ig-post', 'fb-post', 'tw-post', 'yt-video'];
      
      for (const fieldName of socialFields) {
        if (fields[fieldName] && typeof fields[fieldName] === 'string') {
          // If it's a URL, log it but don't use it as content
          if (fields[fieldName].startsWith('http')) {
            console.log(`Field ${fieldName} contains URL: ${fields[fieldName]}`);
            continue;
          }
          
          rawContent = fields[fieldName];
          console.log(`Found content in ${fieldName} field (${rawContent.length} chars)`);
          break;
        }
      }
    }
    
    // Check for OCR needs - either explicitly set or we have no content but have an image
    if (needsOcr || (!rawContent && fields.imgUrl)) {
      console.log('Attempting to extract text from image...');
      
      if (fields.imgUrl) {
        try {
          const imageText = await extractTextFromImage(fields.imgUrl);
          
          if (imageText && imageText.trim().length > 10) { // Ensure we got meaningful text
            console.log(`Successfully extracted ${imageText.length} characters from image`);
            
            // If we already have content, append the image text
            if (rawContent) {
              rawContent += "\n\n[Texto extraído de la imagen:]\n" + imageText;
            } else {
              rawContent = imageText;
            }
            
            // Reset OCR flag since we've now processed it
            try {
              await airtableBase(tableName).update(record.id, {
                isOcrNeeded: false
              });
              console.log('Reset isOcrNeeded flag');
            } catch (resetErr) {
              console.error(`Failed to reset OCR flag: ${resetErr.message}`);
            }
          } else {
            console.log('No significant text found in image');
          }
        } catch (ocrError) {
          console.error(`OCR failed: ${ocrError.message}`);
          // Continue with whatever content we have
        }
      } else {
        console.log('OCR requested but no image URL found');
      }
    }
    
    // Still no content, mark as failed
    if (!rawContent) {
      console.log('No content found in record');
      try {
        await airtableBase(tableName).update(record.id, {
          processingStatus: 'failed',
          processingNotes: 'No content found in record or image'
        });
      } catch (err) {
        console.error(`Failed to update status: ${err.message}`);
      }
      return false;
    }
    
    console.log(`Raw content length: ${rawContent.length} characters`);
    
    // Determine source
    const source = fields.source || getSourceFromFields(fields);
    
    // Generate title, overline, excerpt, and formatted article
    try {
      const generatedContent = await generateAllContentElements(rawContent, source);
      
      // Update record with ALL generated content
      const updateFields = {
        processingStatus: 'completed',
        processingNotes: needsOcr ? 'Successfully processed with OCR' : 'Successfully processed'
      };
      
      // Always update these fields with fresh content
      updateFields.title = generatedContent.title;
      updateFields.overline = generatedContent.overline;
      updateFields.excerpt = generatedContent.excerpt;
      updateFields.article = generatedContent.article;
      
      // Only set source if not already present
      if (!fields.source) {
        updateFields.source = source;
      }
      
      console.log('Updating record with all generated content...');
      
      try {
        await airtableBase(tableName).update(record.id, updateFields);
        console.log('Record updated successfully with title, excerpt, article and overline');
        return true;
      } catch (airtableError) {
        console.error(`Airtable update failed: ${airtableError.message}`);
        
        // If the update fails, try updating just the core fields
        try {
          console.log('Trying to update with minimal fields...');
          await airtableBase(tableName).update(record.id, {
            title: generatedContent.title,
            excerpt: generatedContent.excerpt,
            processingStatus: 'completed'
          });
          console.log('Minimal update succeeded');
          return true;
        } catch (minimalError) {
          console.error(`Even minimal update failed: ${minimalError.message}`);
          return false;
        }
      }
    } catch (contentGenError) {
      console.error(`Content generation failed: ${contentGenError.message}`);
      
      try {
        await airtableBase(tableName).update(record.id, {
          processingStatus: 'error',
          processingNotes: `Content generation failed: ${contentGenError.message.substring(0, 500)}`
        });
      } catch (e) {
        console.error(`Failed to update error status: ${e.message}`);
      }
      
      return false;
    }
  } catch (error) {
    console.error(`Error processing record:`, error);
    
    try {
      await airtableBase(tableName).update(record.id, {
        processingStatus: 'error',
        processingNotes: `Error: ${error.message.substring(0, 500)}`
      });
    } catch (e) {
      console.error('Failed to update error status:', e);
    }
    
    return false;
  }
}

/**
 * Extract text from image using Gemini Vision
 */
async function extractTextFromImage(imageUrl) {
  try {
    console.log(`Extracting text from image: ${imageUrl}`);
    
    // Fetch the image
    const response = await axios.get(imageUrl, { 
      responseType: 'arraybuffer',
      timeout: 10000
    });
    
    const imageData = Buffer.from(response.data).toString("base64");
    
    // Determine MIME type from URL
    let mimeType = "image/jpeg";
    if (imageUrl.includes('.png')) mimeType = "image/png";
    if (imageUrl.includes('.webp')) mimeType = "image/webp";
    if (imageUrl.includes('.gif')) mimeType = "image/gif";
    
    // Call Gemini with vision capabilities
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: mimeType,
          data: imageData,
        },
      },
      {
        text: "Extrae TODO el texto visible en esta imagen. Devuelve solo el texto extraído sin explicaciones, comentarios ni código.",
      },
    ]);

    const textContent = await result.response.text();
    
    if (!textContent || textContent.length === 0) {
      console.warn(`No text found in image`);
      return null;
    }
    
    console.log(`Successfully extracted ${textContent.length} characters from image`);
    return textContent;
  } catch (error) {
    console.error(`Image text extraction failed: ${error.message}`);
    return null;
  }
}

/**
 * Generate all content elements: title, overline, excerpt, and formatted article
 */
async function generateAllContentElements(content, source) {
  try {
    // If content is very long, trim it for AI processing
    const trimmedContent = content.length > 3000 
      ? content.substring(0, 3000) + "..." 
      : content;
    
    console.log('Generating all content elements...');
    
    // Create prompt for AI - MODIFIED to explicitly request plain text
    const prompt = `
    Analiza el siguiente contenido de ${source || 'redes sociales'} y genera:

    Contenido:
    ${trimmedContent}

    Genera:
    1. TÍTULO: Un título periodístico conciso y atractivo de máximo 10 palabras.
    2. OVERLINE: Una palabra o frase muy corta que indique el tema (ej. "Política", "Economía", "Deportes", etc.)
    3. EXTRACTO: Un resumen breve de 15-20 palabras que capture la esencia del contenido.
    4. ARTÍCULO: Una versión formateada y mejorada del contenido original, que conserve todos los datos importantes pero tenga mejor estructura, como un artículo periodístico profesional.

    MUY IMPORTANTE: No uses formato markdown como ** para negritas o * para cursivas. Responde solo con texto plano.
    Responde usando estos encabezados exactos: TÍTULO, OVERLINE, EXTRACTO, ARTÍCULO
    `;
    
    // ADDED: AI timeout and error handling
    try {
      // Call AI model with timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("AI request timeout")), 30000);
      });
      
      const resultPromise = model.generateContent(prompt);
      const result = await Promise.race([resultPromise, timeoutPromise]);
      
      const responseText = (await result.response).text();
      
      // Parse response
      const titleMatch = responseText.match(/TÍTULO:?\s*(.*?)(?=OVERLINE|$)/si);
      const overlineMatch = responseText.match(/OVERLINE:?\s*(.*?)(?=EXTRACTO|$)/si);
      const extractMatch = responseText.match(/EXTRACTO:?\s*(.*?)(?=ARTÍCULO|$)/si);
      const articleMatch = responseText.match(/ARTÍCULO:?\s*([\s\S]*)/si);
      
      // Format the article content with the original content if AI formatting fails
      let formattedArticle = content;
      if (articleMatch && articleMatch[1].trim()) {
        formattedArticle = articleMatch[1].trim();
      } else {
        // Basic formatting if AI didn't produce an article
        formattedArticle = formatRawContent(content, source);
      }
      
      // ADDED: Remove Markdown formatting from all content
      const removeMarkdown = (text) => {
        if (!text) return text;
        return text
          .replace(/\*\*/g, '')  // Remove bold
          .replace(/\*/g, '')    // Remove italics
          .replace(/\_\_/g, '')  // Remove underline
          .replace(/\_/g, '')    // Remove single underscores
          .replace(/\`\`\`[a-z]*\n([\s\S]*?)\n\`\`\`/g, '$1')  // Remove code blocks
          .replace(/\`(.*?)\`/g, '$1');  // Remove inline code
      };
      
      return {
        title: removeMarkdown(titleMatch ? titleMatch[1].trim() : createBasicTitle(content, source)),
        overline: removeMarkdown(overlineMatch ? overlineMatch[1].trim() : source || "Redes Sociales"),
        excerpt: removeMarkdown(extractMatch ? extractMatch[1].trim() : content.substring(0, 150) + "..."),
        article: removeMarkdown(formattedArticle)
      };
    } catch (aiError) {
      console.error(`AI processing failed: ${aiError.message}`);
      throw new Error(`AI processing failed: ${aiError.message}`);
    }
  } catch (error) {
    console.error('Error generating content elements:', error);
    
    // Fallback to basic extraction
    return {
      title: createBasicTitle(content, source),
      overline: source || "Redes Sociales",
      excerpt: content.substring(0, 150) + "...",
      article: formatRawContent(content, source)
    };
  }
}

/**
 * Create a basic title from content when AI fails
 */
function createBasicTitle(content, source) {
  try {
    // Get first sentence or line
    const firstLine = content.split(/[\n\r.!?]+/)[0].trim();
    
    if (firstLine.length <= 80) {
      return firstLine;
    } else {
      // Use first 8 words
      return firstLine
        .split(/\s+/)
        .slice(0, 8)
        .join(' ') + '...';
    }
  } catch (e) {
    return `Publicación de ${source || 'Redes Sociales'}`;
  }
}

/**
 * Format raw content into a presentable article when AI fails
 */
function formatRawContent(content, source) {
  // Add basic structure to the content
  const dateStr = new Date().toLocaleDateString('es-AR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  return `${content}

---

Fuente: ${source || 'Redes Sociales'}
Fecha de publicación: ${dateStr}`;
}

/**
 * Get source from social media fields
 */
function getSourceFromFields(fields) {
  if (fields.source) return fields.source;
  if (fields['ig-post']) return 'Instagram';
  if (fields['fb-post']) return 'Facebook';
  if (fields['tw-post']) return 'Twitter';
  if (fields['yt-video']) return 'YouTube';
  return 'Redes Sociales';
}

// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const options = {
    tableName: args.find(arg => !arg.startsWith('--')) || 'Instituciones',
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

export { processSocialMediaContent }
