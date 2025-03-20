const axios = require('axios')
const { JSDOM } = require('jsdom')
const { Readability } = require('@mozilla/readability')
const { GoogleGenerativeAI } = require('@google/generative-ai') // Import Gemini AI

// Airtable configuration
const personalAccessToken =
  'patlPzRF8YzZNnogn.0eb9f596eaeaea391004e75e5c3e9e24627f26ae16319fd534b9af8c8b165e66' // Replace with your token
const baseId = 'appmc2j8nMRpZM8dV' // Replace with your base ID
const tableName = 'Test' // Replace with your table name

// Airtable API endpoint
const airtableApiUrl = `https://api.airtable.com/v0/${baseId}/${tableName}`

// Gemini AI configuration
const geminiApiKey = 'AIzaSyC1yV4kmJRug41jyNBjUxBIemXWTSHMjB4' // Replace with your Gemini API key
const genAI = new GoogleGenerativeAI(geminiApiKey) // Initialize Gemini AI
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' }) // Use the Gemini Flash model

// Define the URL of the JSON data
const jsonUrl = 'https://rss.app/feeds/v1.1/_Fl3IYhnnTrOHPafk.json'

// Function to add a delay between requests
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Function to fetch HTML content from a URL
async function fetchContent(url) {
  try {
    const response = await axios.get(url, { timeout: 10000 }) // Set timeout to 10 seconds
    return response.data // This will contain the HTML or text content
  } catch (error) {
    console.error(`Error fetching content from ${url}:`, error.message)
    return null // Return null if there's an error
  }
}

// Function to extract text from HTML content using Readability
function extractText(htmlContent) {
  try {
    // Parse the HTML content into a DOM
    const dom = new JSDOM(htmlContent)

    // Use Readability to extract the main content
    const reader = new Readability(dom.window.document)
    const article = reader.parse()

    // Return the extracted content or fallback to an empty string
    return article && article.textContent ? article.textContent.trim() : ''
  } catch (error) {
    console.error('Error extracting text:', error.message)
    return '' // Return an empty string if there's an error
  }
}

// Function to generate metadata with retry and exponential backoff
async function generateMetadataWithRetry(extractedText, maxRetries = 5) {
  let retries = 0
  while (retries < maxRetries) {
    try {
      const prompt = `
        Extracted Text: "${extractedText}"
        
        Basado en el texto anterior, genera lo siguiente:
        1. Un título conciso y atractivo. **No uses mayúsculas en todas las palabras** (evita el title case). Solo usa mayúsculas al principio del título y en nombres propios. ESTO ES MUY IMPORTANTE Y HAY QUE RESPETARLO A RAJATABLA.
        2. Un resumen (bajada) de 40 a 50 palabras que capture los puntos clave. **No uses mayúsculas en todas las palabras**. Solo usa mayúsculas al principio de cada oración y en nombres propios.
        3. Una volanta corta que brinde contexto o destaque la importancia del artículo. **No uses mayúsculas en todas las palabras**. Solo usa mayúsculas al principio y en nombres propios.
        
        Return the output in JSON format:
        {
          "title": "Generated Title",
          "bajada": "Generated 40-50 word summary",
          "volanta": "Generated overline"
        }
      `

      // Add a delay before making the request
      await delay(1000) // 1-second delay

      const result = await model.generateContent(prompt)
      const response = await result.response
      const text = response.text()

      // Clean up the response to remove Markdown code blocks
      const cleanedText = text
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim()

      // Parse the cleaned JSON output
      const metadata = JSON.parse(cleanedText)
      return metadata
    } catch (error) {
      if (error.message.includes('429')) {
        // Exponential backoff: wait for 2^retries seconds
        const waitTime = Math.pow(2, retries) * 1000
        console.warn(
          `Rate limit exceeded. Retrying in ${waitTime / 1000} seconds...`
        )
        await delay(waitTime)
        retries++
      } else {
        console.error(
          'Error generating metadata with Gemini AI:',
          error.message
        )
        return null
      }
    }
  }
  console.error('Max retries reached. Unable to generate metadata.')
  return null
}

// Function to split records into chunks of 10
function chunkArray(records, chunkSize) {
  const chunks = []
  for (let i = 0; i < records.length; i += chunkSize) {
    chunks.push(records.slice(i, i + chunkSize))
  }
  return chunks
}

// Function to reelaborate the extracted text using a prompt
async function reelaborateTextWithPrompt(
  extractedText,
  prompt,
  maxRetries = 5
) {
  let retries = 0
  while (retries < maxRetries) {
    try {
      const fullPrompt = `
        ${prompt}
        
        Texto extraído: "${extractedText}"
      `

      // Add a delay before making the request
      await delay(1000) // 1-second delay

      const result = await model.generateContent(fullPrompt)
      const response = await result.response
      const text = response.text()

      // Clean up the response to remove Markdown code blocks
      const cleanedText = text
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim()

      return cleanedText // Return the reelaborated text
    } catch (error) {
      if (error.message.includes('429')) {
        // Exponential backoff: wait for 2^retries seconds
        const waitTime = Math.pow(2, retries) * 1000
        console.warn(
          `Rate limit exceeded. Retrying in ${waitTime / 1000} seconds...`
        )
        await delay(waitTime)
        retries++
      } else {
        console.error('Error reelaborating text with Gemini AI:', error.message)
        return null
      }
    }
  }
  console.error('Max retries reached. Unable to reelaborate text.')
  return null
}

// Fetch JSON data and insert into Airtable
async function fetchAndInsertData() {
  try {
    // Fetch JSON data
    const response = await axios.get(jsonUrl)
    const jsonData = response.data

    // Log the entire JSON object for debugging
    console.log('Fetched JSON data:', JSON.stringify(jsonData, null, 2))

    // Check if the data contains items
    if (jsonData.items && Array.isArray(jsonData.items)) {
      console.log(`Fetched ${jsonData.items.length} items.`)

      // Limit the number of items to 5
      const limitedItems = jsonData.items.slice(5, 10)
      console.log(`Processing ${limitedItems.length} items.`)

      // Prepare records for Airtable
      const records = await Promise.all(
        limitedItems.map(async (item) => {
          const htmlContent = await fetchContent(item.url) // Fetch HTML content from the URL
          const extractedText = htmlContent ? extractText(htmlContent) : '' // Extract text from the HTML

          // Skip if extractedText is empty or too short
          if (!extractedText || extractedText.length < 50) {
            console.warn(
              `Skipping item with URL: ${item.url} due to insufficient content.`
            )
            return null // Skip this record
          }

          // Reelaborate the extracted text using the prompt
          const prompt = `Reelaborar la siguiente noticia siguiendo estas pautas:

1. **Lenguaje**:
   - Utilizar un **español rioplatense formal**, adecuado para un contexto periodístico o informativo.
   - Emplear expresiones y giros propios del español rioplatense, pero mantener un tono profesional y respetuoso.

2. **Objetividad**:
   - Mantener un tono neutral y objetivo. No incluir juicios de valor, opiniones personales o lenguaje tendencioso.
   - Limitarse a presentar los hechos de manera clara y precisa.

3. **Claridad y Sencillez**:
   - Usar un lenguaje sencillo y accesible, evitando tecnicismos innecesarios.
   - Asegurarse de que la información sea fácil de entender para un público general.

4. **Estructura**:
   - **Título**: Crear un titular claro y descriptivo que resuma el tema central de la noticia.
   - **Bajada**: Escribir un párrafo introductorio que resuma los puntos clave de la noticia de manera concisa.
   - **Cuerpo**:
     - Organizar la información en párrafos cortos y bien estructurados.
     - Usar subtítulos (si es necesario) para dividir el texto en secciones temáticas.
     - Incluir datos, cifras y citas textuales relevantes, siempre que estén respaldados por fuentes confiables.
   - **Conclusión**: Resumir los puntos principales de la noticia sin añadir interpretaciones o valoraciones. Está prohibido usar titulos y expresiones explicitos como "en resumen", "conclusión", "en conclusión", "en resumen", "en síntesis" o similares. 

5. **Sintaxis y Visualidad**:
   - Usar oraciones cortas y directas para facilitar la lectura.
   - Incorporar elementos visuales como:
     - **Listas con viñetas** para enumerar puntos clave.
     - **Negritas** para resaltar información importante (por ejemplo, cifras o nombres propios).
     - **Citas textuales** entre comillas para destacar declaraciones relevantes.

6. **Fuentes**:
   - Si la noticia original incluye fuentes o referencias, asegurarse de citarlas correctamente.
   - Si no hay fuentes, evitar especulaciones o suposiciones.

7. **Formato de Salida**:
   - Devolver la noticia reelaborada en formato Markdown

8. **Palabras Estrictamente Prohibidas**: Las siguiente palabras no deben aparecer en ninguna parte del texto: fusionar - fusionándose - reflejar - reflejándose - sumergir - sumergirse - en resumen - conclusión - en síntesis - markdown  

9. **Títulos**: No incluir un título en el artículo bajo ninguna circunstancia. El título ya está generado en otro campo del registro de Airtable, por lo que no es necesario repetirlo en el contenido. Comenzar directamente con el cuerpo del texto. 
   
   `
          const reelaboratedText = await reelaborateTextWithPrompt(
            extractedText,
            prompt
          )

          // Extract main image and additional attachment URLs

          const attachments = item.attachments || [] // Array of attachment objects
          const attachmentUrls = attachments.map((attachment) => attachment.url) // Extract URLs from attachments
          const imgUrl = [...attachmentUrls].filter(Boolean).join(', ') // Combine all image URLs into an array

          // Generate title, bajada, and volanta using Gemini AI with retry logic
          const metadata = await generateMetadataWithRetry(extractedText)

          return {
            fields: {
              title: metadata ? metadata.title : item.title, // Use generated title or fallback to original title
              url: item.url,
              article: reelaboratedText || extractedText, // Use reelaborated text or fallback to original extracted text
              imgUrl: imgUrl, // Add the array of image URLs to the 'imgUrl' field
              bajada: metadata ? metadata.bajada : 'No summary available.', // Add bajada field
              volanta: metadata ? metadata.volanta : 'No overline available.', // Add volanta field
            },
          }
        })
      )

      // Filter out null records
      const validRecords = records.filter((record) => record !== null)

      // Split records into chunks of 10
      const chunkSize = 10
      const recordChunks = chunkArray(validRecords, chunkSize)

      // Insert records in batches
      for (let i = 0; i < recordChunks.length; i++) {
        const chunk = recordChunks[i]
        const airtableResponse = await axios.post(
          airtableApiUrl,
          { records: chunk },
          {
            headers: {
              Authorization: `Bearer ${personalAccessToken}`,
              'Content-Type': 'application/json',
            },
          }
        )
        console.log(
          `Inserted batch ${i + 1} of ${recordChunks.length} with ${
            chunk.length
          } records.`
        )
      }

      console.log('All records inserted successfully.')
    } else {
      console.log('No items found in the JSON data.')
    }
  } catch (error) {
    console.error(
      'Error:',
      error.response ? error.response.data : error.message
    )
  }
}

// Run the function
fetchAndInsertData()
