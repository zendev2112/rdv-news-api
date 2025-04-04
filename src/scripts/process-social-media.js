import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import path from 'path';

// Configure environment variables
dotenv.config();

// Create __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import services
import Airtable from 'airtable';
import config from '../config/index.js';
import sharp from 'sharp';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize services
const airtableBase = new Airtable({
  apiKey: process.env.AIRTABLE_TOKEN,
}).base(process.env.AIRTABLE_BASE_ID);

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
const model = genAI.getGenerativeModel({ model: config.gemini.model });

// Create temp directory for image downloads
const TEMP_DIR = path.join(__dirname, '../../temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Helper function to create a delay
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main function to process social media content with OCR
 */
async function processSocialMediaContent() {
  console.log('Looking for social media content that needs processing...');

  try {
    // Verify Airtable credentials
    console.log('Checking Airtable connection...');
    console.log(`Using Base ID: ${process.env.AIRTABLE_BASE_ID}`);
    console.log(`Token available: ${process.env.AIRTABLE_TOKEN ? 'Yes (length: ' + process.env.AIRTABLE_TOKEN.length + ')' : 'No'}`);
    
    // Get all records without sorting by creation time
    console.log('Getting records from Instituciones table...');
    try {
      const allRecords = await airtableBase('Instituciones')
        .select({
          maxRecords: 20
        })
        .all();
      
      console.log(`Found ${allRecords.length} total records in Instituciones table`);
      
      if (allRecords.length === 0) {
        console.log('No records found in the table');
        return;
      }
      
      // Rest of your code...
      // Log the first record to inspect what fields actually exist
      if (allRecords.length > 0) {
        console.log('First record field names:', Object.keys(allRecords[0].fields));
        console.log('First record sample data:', JSON.stringify({
          title: allRecords[0].fields.title,
          url: allRecords[0].fields.url,
          imgUrl: allRecords[0].fields.imgUrl,
          processingStatus: allRecords[0].fields.processingStatus
        }, null, 2));
      }
      
      // Now filter manually to find records that need processing
      let recordsToProcess = allRecords.filter(record => 
        record.fields.processingStatus === 'needs_extraction' || 
        !record.fields.processingStatus
      );
      
      console.log(`Found ${recordsToProcess.length} records that need processing`);
      
      // If no records found with needs_extraction, just grab a recent unprocessed one
      if (recordsToProcess.length === 0 && allRecords.length > 0) {
        recordsToProcess = [allRecords[0]];
        console.log('No records explicitly need processing, but processing first record as test');
      }
      
      if (recordsToProcess.length === 0) {
        console.log('No records to process');
        return;
      }
      
      // Process each record
      for (const record of recordsToProcess) {
        try {
          console.log(`\nProcessing record: ${record.id}`);
          console.log('Image URL:', record.fields.imgUrl);
          await processRecord(record);
          await delay(3000);
        } catch (error) {
          console.error(`Error processing record ${record.id}:`, error.message);
        }
      }
    } catch (airtableError) {
      // Improved error handling for Airtable connection issues
      console.error('Airtable API error:', airtableError.message);
      
      if (airtableError.statusCode) {
        console.error(`Status code: ${airtableError.statusCode}`);
      }
      
      // Try to access error details if available
      if (airtableError.response) {
        console.error('Error response:', airtableError.response.data || airtableError.response);
      }
      
      // Manual API test using axios directly
      console.log('\nTrying direct API test with axios...');
      try {
        const testResponse = await axios({
          method: 'GET',
          url: `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Instituciones?maxRecords=1`,
          headers: {
            'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });
        console.log('Direct API test succeeded! Status:', testResponse.status);
      } catch (axiosError) {
        console.error('Direct API test failed:', axiosError.message);
        if (axiosError.response) {
          console.error('Status:', axiosError.response.status);
          console.error('Data:', axiosError.response.data);
        }
      }
      
      throw airtableError;
    }
    
    console.log('Completed processing social media content');
  } catch (error) {
    console.error('Error processing social media content:', error.message);
  }
}

/**
 * Process a single record
 */
async function processRecord(record) {
  try {
    const fields = record.fields;

    // Skip if no imgUrl
    if (!fields.imgUrl) {
      console.log(`No image found for record ${record.id}`);
      await airtableBase('Instituciones').update(record.id, {
        processingStatus: 'no_image',
        processingNotes: 'No image URL found in record',
        status: 'Published', // Mark as published anyway
      });
      return;
    }

    // Download the image
    console.log(`Downloading image: ${fields.imgUrl}`);
    const imagePath = await downloadImage(fields.imgUrl);

    if (!imagePath) {
      console.error(`Failed to download image: ${fields.imgUrl}`);
      await airtableBase('Instituciones').update(record.id, {
        processingStatus: 'error',
        processingNotes: `Failed to download image: ${fields.imgUrl}`,
      });
      return;
    }

    // Extract text from image using Gemini
    console.log('Extracting text from image...');
    const extractedText = await extractTextFromImage(imagePath);

    // Generate structured content from extracted text
    let content = {};
    if (extractedText) {
      console.log(`Extracted ${extractedText.length} characters of text`);
      content = await generateContent(extractedText, fields);
    } else {
      console.log('No text extracted from image');
      content = {
        title: fields.title || 'Publicación de Redes Sociales',
        summary: fields.bajada || 'No se pudo extraer texto de la imagen',
        article: `## ${fields.title || 'Publicación de Redes Sociales'}\n\n${
          fields.bajada || ''
        }\n\n**Fuente:** ${fields.volanta || 'Redes Sociales'}`,
      };
    }

    // Update the record with the extracted content
    console.log('Updating record with extracted content');
    await airtableBase('Instituciones').update(record.id, {
      title: content.title,
      bajada: content.summary,
      article: content.article,
      processingStatus: 'completed',
      processingNotes: 'Successfully processed with title and summary',
      status: 'Published',
    });

    console.log(`Record ${record.id} updated successfully`);

    // Clean up temporary file
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
  } catch (error) {
    console.error(`Error processing record:`, error.message);

    // Update record with error status - using a predefined option
    try {
      await airtableBase('Instituciones').update(record.id, {
        processingStatus: 'error',
        processingNotes: `Error during processing: ${error.message.substring(
          0,
          500
        )}`,
      });
    } catch (e) {
      console.error('Failed to update record error status:', e.message);
    }
  }
}

/**
 * Download an image from a URL with better error handling and URL normalization
 */
async function downloadImage(imageUrl) {
  try {
    if (!imageUrl) {
      console.error('No image URL provided');
      return null;
    }
    
    console.log(`Downloading image from: ${imageUrl}`);
    
    // Simple URL cleanup
    const normalizedUrl = imageUrl.trim();
    
    try {
      // Try a simpler download approach
      const response = await axios({
        url: normalizedUrl,
        method: 'GET',
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      // Create a unique filename
      const filename = `image-${Date.now()}.jpg`;
      const filepath = path.join(TEMP_DIR, filename);
      
      // Write the file
      fs.writeFileSync(filepath, response.data);
      console.log(`Image saved to: ${filepath}`);
      
      // Check file size
      const stats = fs.statSync(filepath);
      if (stats.size > 0) {
        console.log(`Download successful: ${stats.size} bytes`);
        return filepath;
      } else {
        console.error('Downloaded file is empty');
        fs.unlinkSync(filepath);
        return null;
      }
    } catch (downloadError) {
      console.error(`Download error: ${downloadError.message}`);
      
      // Try an alternative download method using a stream
      console.log('Trying alternative download method...');
      return await downloadImageAsStream(normalizedUrl);
    }
  } catch (error) {
    console.error(`Image download failed: ${error.message}`);
    return null;
  }
}

// Add this new helper function for stream-based downloads
async function downloadImageAsStream(url) {
  try {
    const filename = `stream-image-${Date.now()}.jpg`;
    const filepath = path.join(TEMP_DIR, filename);
    const writer = fs.createWriteStream(filepath);
    
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
      timeout: 15000
    });
    
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`Stream download completed: ${filepath}`);
        resolve(filepath);
      });
      writer.on('error', err => {
        console.error(`Stream download failed: ${err.message}`);
        reject(err);
      });
    });
  } catch (error) {
    console.error(`Stream download error: ${error.message}`);
    return null;
  }
}

/**
 * Extract text from an image using Gemini Vision with enhanced preprocessing
 */
async function extractTextFromImage(imagePath) {
  try {
    console.log('Starting image preprocessing for better OCR...');
    
    // Read the original image
    let imageBuffer = fs.readFileSync(imagePath);
    
    // Create a preprocessed version with enhanced readability
    const enhancedImageBuffer = await sharp(imageBuffer)
      // Resize to reasonable dimensions while maintaining aspect ratio
      .resize({ width: 1500, height: 1500, fit: 'inside' })
      // Increase contrast to make text more visible
      .normalize()
      // Sharpen the image to improve text edges
      .sharpen({ sigma: 1.2 })
      // Reduce noise which can interfere with text recognition
      .median(1)
      // Force output format to be high quality
      .jpeg({ quality: 90 })
      .toBuffer();
    
    // Save enhanced image for inspection if needed
    const enhancedPath = `${imagePath.replace(/\.[^/.]+$/, '')}-enhanced.jpg`;
    fs.writeFileSync(enhancedPath, enhancedImageBuffer);
    console.log(`Enhanced image saved to: ${enhancedPath}`);
    
    // Also create a high-contrast version optimized for text
    const bwImageBuffer = await sharp(imageBuffer)
      .resize({ width: 1500, height: 1500, fit: 'inside' })
      // Apply grayscale 
      .grayscale()
      // Increase contrast dramatically
      .normalize()
      // Make black and white with threshold
      .threshold(128)
      // Sharpen the text
      .sharpen({ sigma: 1.5 })
      .jpeg({ quality: 90 })
      .toBuffer();
      
    // Save B&W image for inspection
    const bwPath = `${imagePath.replace(/\.[^/.]+$/, '')}-bw.jpg`;
    fs.writeFileSync(bwPath, bwImageBuffer);
    console.log(`B&W image saved to: ${bwPath}`);
    
    // Convert to base64 for both versions
    const normalBase64 = enhancedImageBuffer.toString('base64');
    const bwBase64 = bwImageBuffer.toString('base64');
    
    // Try to extract text from both the enhanced color version and B&W version
    console.log('Attempting text extraction with enhanced color image...');
    const colorResult = await model.generateContent([
      "Extract all visible text from this image. The image may be a flyer, social media post, or other content with text. Return ONLY the extracted text with appropriate formatting (paragraphs, etc.). Don't include any explanations or descriptions, just the extracted text.",
      {
        inlineData: {
          data: normalBase64,
          mimeType: 'image/jpeg',
        },
      },
    ]);
    
    const colorText = (await colorResult.response).text().trim();
    console.log(`Extracted ${colorText.length} characters from color image`);
    
    // If we got substantial text from the color version, use that
    if (colorText.length > 100) {
      console.log('Using color image extraction result');
      return colorText;
    }
    
    // Otherwise try the B&W high-contrast version
    console.log('Attempting text extraction with B&W high-contrast image...');
    const bwResult = await model.generateContent([
      "Extract all visible text from this black and white image. Focus on reading any text visible in the image, including small text. Return ONLY the extracted text with appropriate formatting (paragraphs, etc.). Don't include any explanations or descriptions.",
      {
        inlineData: {
          data: bwBase64,
          mimeType: 'image/jpeg',
        },
      },
    ]);
    
    const bwText = (await bwResult.response).text().trim();
    console.log(`Extracted ${bwText.length} characters from B&W image`);
    
    // Use the longer extraction result
    if (bwText.length > colorText.length) {
      console.log('Using B&W image extraction (better result)');
      return bwText;
    } else {
      console.log('Using color image extraction (better result)');
      return colorText;
    }
  } catch (error) {
    console.error('Error extracting text from image:', error.message);
    // If an error occurred with the enhanced version, try the basic approach
    try {
      console.log('Falling back to basic image processing...');
      const imageBuffer = await sharp(fs.readFileSync(imagePath))
        .resize({ width: 1200, fit: 'inside' })
        .toBuffer();
      
      const base64Image = imageBuffer.toString('base64');
      
      const result = await model.generateContent([
        "Extract all visible text from this image. Return ONLY the text.",
        {
          inlineData: {
            data: base64Image,
            mimeType: 'image/jpeg',
          },
        },
      ]);
      
      const extractedText = (await result.response).text().trim();
      return extractedText;
    } catch (fallbackError) {
      console.error('Fallback extraction also failed:', fallbackError.message);
      return '';
    }
  } finally {
    // Clean up temporary enhanced images
    const enhancedPath = `${imagePath.replace(/\.[^/.]+$/, '')}-enhanced.jpg`;
    const bwPath = `${imagePath.replace(/\.[^/.]+$/, '')}-bw.jpg`;
    
    // Only delete if not in debug mode
    const debugMode = process.env.DEBUG === 'true';
    if (!debugMode) {
      if (fs.existsSync(enhancedPath)) fs.unlinkSync(enhancedPath);
      if (fs.existsSync(bwPath)) fs.unlinkSync(bwPath);
    }
  }
}

/**
 * Generate structured content from extracted text
 */
async function generateContent(extractedText, fields) {
  try {
    // Build prompt for content generation with title and summary
    const prompt = `
      Tengo un texto extraído de una imagen publicada en redes sociales que necesito estructurar:
      
      Fuente: ${fields.volanta || 'Social Media'}
      Título original: ${fields.title || 'Publicación de Redes Sociales'}
      Descripción original: ${fields.bajada || ''}
      
      Texto extraído de la imagen:
      "${extractedText}"
      
      Genera los siguientes elementos basados en este texto:
      
      1. TÍTULO: Un título conciso y atractivo de máximo 10 palabras.
      
      2. RESUMEN: Un resumen de 40-50 palabras que capture la esencia del contenido.
      
      3. ARTÍCULO COMPLETO: Un artículo estructurado siguiendo estas pautas:
         - Usa un título claro en formato H2 (## Título)
         - Organiza la información en párrafos lógicos y concisos
         - Incluye al menos una lista con viñetas (- Elemento) con los puntos clave
         - Usa **negritas** para destacar información importante
         - Si hay fechas, horarios o lugares de eventos, destácalos claramente
         - No inventes información que no esté en el texto original
         - Usa formato markdown adecuado: subtítulos con ##, listas con -, negritas con **
         - La variedad lingüistica a utilizar es español rioplatense FORMAL.
         - No utilizar signos de exclamacion
         - No apelar al lector
      
      Responde con estos tres elementos claramente separados por las etiquetas [TÍTULO], [RESUMEN] y [ARTÍCULO], sin incluir estas etiquetas en el contenido.
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const fullText = response.text().trim();
    
    // Parse the returned content
    const titleMatch = fullText.match(/\[TÍTULO\]([\s\S]*?)\[RESUMEN\]/i);
    const summaryMatch = fullText.match(/\[RESUMEN\]([\s\S]*?)\[ARTÍCULO\]/i);
    const articleMatch = fullText.match(/\[ARTÍCULO\]([\s\S]*)/i);
    
    // Extract each part or use fallbacks
    const title = titleMatch ? titleMatch[1].trim() : fields.title || 'Publicación de Redes Sociales';
    const summary = summaryMatch ? summaryMatch[1].trim() : fields.bajada || 'Resumen no disponible';
    const article = articleMatch ? articleMatch[1].trim() : fullText;
    
    console.log('Generated title:', title);
    console.log('Generated summary:', summary);
    console.log('Generated article length:', article.length, 'characters');
    
    // Return all components
    return {
      title,
      summary,
      article
    };
  } catch (error) {
    console.error('Error generating content:', error.message);

    // Return simple formatted content as fallback
    return {
      title: fields.title || 'Publicación de Redes Sociales',
      summary: fields.bajada || 'Resumen no disponible',
      article: `
## ${fields.title || 'Publicación de Redes Sociales'}

${extractedText}

**Información extraída de una publicación en ${fields.volanta || 'redes sociales'}**
      `
    };
  }
}

// Check if this is the main module
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  processSocialMediaContent()
    .then(() => {
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

export { processSocialMediaContent };
