const { GoogleGenerativeAI } = require('@google/generative-ai')
const config = require('../config')
const logger = require('../utils/logger')
const { delay } = require('../utils/helpers')

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(config.ai.geminiApiKey)
const model = genAI.getGenerativeModel({ model: config.ai.model })

/**
 * Generates metadata for an article with retry logic
 * @param {string} extractedText - The extracted article text
 * @param {number} maxRetries - Maximum number of retries
 * @returns {Promise<Object|null>} - Metadata object or null if failed
 */
async function generateMetadata(extractedText, maxRetries = 5) {
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

      await delay(1000)
      const result = await model.generateContent(prompt)
      const response = await result.response
      const text = response.text()

      const cleanedText = text
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim()

      return JSON.parse(cleanedText)
    } catch (error) {
      if (error.message.includes('429')) {
        const waitTime = Math.pow(2, retries) * 1000
        logger.warn(
          `Rate limit exceeded. Retrying in ${waitTime / 1000} seconds...`
        )
        await delay(waitTime)
        retries++
      } else {
        logger.error(`Error generating metadata:`, error)
        return null
      }
    }
  }

  logger.error('Max retries reached. Unable to generate metadata.')
  return null
}

/**
 * Reelaborates article text using AI
 * @param {string} extractedText - The extracted article text
 * @param {string} customPrompt - Custom prompt for reelaboration
 * @param {number} maxRetries - Maximum number of retries
 * @returns {Promise<string|null>} - Reelaborated text or null if failed
 */
async function reelaborateText(extractedText, customPrompt, maxRetries = 5) {
  let retries = 0
  while (retries < maxRetries) {
    try {
      const fullPrompt = `
        ${customPrompt}
        
        Texto extraído: "${extractedText}"
      `

      await delay(1000)
      const result = await model.generateContent(fullPrompt)
      const response = await result.response
      const text = response.text()

      return text
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim()
    } catch (error) {
      if (error.message.includes('429')) {
        const waitTime = Math.pow(2, retries) * 1000
        logger.warn(
          `Rate limit exceeded. Retrying in ${waitTime / 1000} seconds...`
        )
        await delay(waitTime)
        retries++
      } else {
        logger.error(`Error reelaborating text:`, error)
        return null
      }
    }
  }

  logger.error('Max retries reached. Unable to reelaborate text.')
  return null
}

module.exports = {
  generateMetadata,
  reelaborateText,
}
