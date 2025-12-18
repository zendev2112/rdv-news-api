import { GoogleGenerativeAI } from '@google/generative-ai'
import { logger } from '../utils/logger.js'

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

/**
 * Generate content using Gemini ONLY
 */
export async function generateContent(prompt, options = {}) {
  const {
    model = process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    temperature = 0.7,
    maxTokens = 2048,
  } = options

  try {
    logger.info(`🤖 Using Gemini model: ${model}`)

    const geminiModel = genAI.getGenerativeModel({ model })

    const result = await geminiModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    })

    const response = result.response
    const text = response.text()

    logger.info(`✅ Gemini generation successful (${text.length} chars)`)

    return {
      text,
      model,
      provider: 'gemini',
    }
  } catch (error) {
    logger.error(`❌ Gemini generation failed: ${error.message}`)
    throw new Error(`Gemini API error: ${error.message}`)
  }
}

/**
 * Batch generate content for multiple prompts
 */
export async function batchGenerateContent(prompts, options = {}) {
  const results = []

  for (const prompt of prompts) {
    try {
      const result = await generateContent(prompt, options)
      results.push(result)
    } catch (error) {
      logger.error(`Batch generation failed for prompt: ${error.message}`)
      results.push({ error: error.message })
    }
  }

  return results
}
