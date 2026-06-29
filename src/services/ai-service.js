import { GoogleGenerativeAI } from '@google/generative-ai'
import axios from 'axios'
import logger from '../utils/logger.js'

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

// Track usage stats
let usageStats = {
  totalRequests: 0,
  totalTokens: 0,
  totalCost: 0,
  errors: 0,
}

/**
 * Generate content using Gemini ONLY
 */
export async function generateContent(prompt, options = {}) {
  const {
    model = process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    temperature = 0.7,
    maxTokens = 8192,
    timeout = 60000,
    thinkingBudget, // optional: 0 disables 2.5 "thinking" so output isn't starved
  } = options

  try {
    usageStats.totalRequests++
    logger.info(`🤖 Using Gemini model: ${model}`)

    const geminiModel = genAI.getGenerativeModel({ model })

    const generationConfig = {
      temperature,
      maxOutputTokens: maxTokens,
    }
    if (thinkingBudget !== undefined) {
      generationConfig.thinkingConfig = { thinkingBudget }
    }

    const result = await Promise.race([
      geminiModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`AI generation timeout (${timeout / 1000}s)`)),
          timeout,
        ),
      ),
    ])

    const response = result.response
    const text = response.text()

    logger.info(`✅ Gemini generation successful (${text.length} chars)`)

    return {
      text,
      model,
      provider: 'gemini',
    }
  } catch (error) {
    usageStats.errors++
    logger.error(`❌ Gemini generation failed: ${error.message}`)
    throw new Error(`Gemini API error: ${error.message}`)
  }
}

/**
 * Cheap liveness probe for the Gemini key/API. One tiny call, thinking disabled.
 *
 * Returns { ok: true } when generation works, or { ok: false, error } when the
 * key is invalid, the Generative Language API is disabled on the project, or the
 * service is unreachable. Callers use this to abort a run loudly instead of
 * silently producing fallback (non-reelaborated) drafts — the exact failure mode
 * that hid a disabled API in production.
 */
export async function checkGeminiHealth() {
  try {
    const result = await generateContent('Respondé únicamente con: OK', {
      maxTokens: 16,
      thinkingBudget: 0, // no thinking — don't starve a 16-token budget
      timeout: 15000,
    })
    if (!result.text || !result.text.trim()) {
      return { ok: false, error: 'Gemini returned an empty response' }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

/**
 * Classify an image for republishing rights via Gemini vision.
 *
 * RDV may reuse institutional images freely, but from otros medios only
 * **flyers/afiches** (shared institutional assets) — never the outlet's own
 * photographs. This tells flyer from photo and flags media watermarks/logos.
 *
 * Fails OPEN: on any fetch/vision error returns { isFlyer: null } so a flaky
 * vision call never silently discards a usable image — the gate/human catches it.
 *
 * @param {string} imageUrl
 * @returns {Promise<{isFlyer: boolean|null, watermark: string|null, error?: string}>}
 */
export async function classifyImageForUse(imageUrl, options = {}) {
  const {
    timeout = 20000,
    model = process.env.GEMINI_VISION_MODEL ||
      process.env.GEMINI_MODEL ||
      'gemini-2.5-flash',
  } = options
  try {
    if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
      return { isFlyer: null, watermark: null, error: 'invalid-url' }
    }
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout,
      maxContentLength: 10 * 1024 * 1024,
      headers: {
        // Many image hosts (Wikimedia, CDNs) 403 a default client UA.
        'User-Agent':
          'Mozilla/5.0 (compatible; RDVNewsBot/1.0; +https://rdv-news-api.vercel.app)',
        Accept: 'image/*,*/*',
      },
    })
    let mimeType = (response.headers['content-type'] || '').split(';')[0].trim()
    if (!mimeType || !mimeType.startsWith('image/')) {
      if (imageUrl.includes('.png')) mimeType = 'image/png'
      else if (imageUrl.includes('.webp')) mimeType = 'image/webp'
      else if (imageUrl.includes('.gif')) mimeType = 'image/gif'
      else mimeType = 'image/jpeg'
    }
    const data = Buffer.from(response.data).toString('base64')

    const visionModel = genAI.getGenerativeModel({ model })
    const prompt = `Analizá esta imagen para uso en un medio de noticias. Respondé SOLO con JSON, sin explicaciones:
{"tipo":"flyer|foto","marca_de_agua":"<nombre del medio o fotógrafo, o null>"}
- "flyer": placa, afiche o gráfica de diseño (texto, logos, promoción de un evento o comunicado).
- "foto": fotografía real (personas, lugares, objetos, hechos).
- marca_de_agua: si hay un logo, marca de agua o texto sobreimpreso que identifique a un medio de prensa o a un fotógrafo, indicá cuál; si no hay, poné null.`

    const result = await Promise.race([
      visionModel.generateContent([
        { inlineData: { mimeType, data } },
        { text: prompt },
      ]),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('vision timeout')), timeout),
      ),
    ])
    const text = result.response.text() || ''
    const match = text.replace(/```json|```/gi, '').match(/\{[\s\S]*\}/)
    if (!match) return { isFlyer: null, watermark: null, error: 'unparseable' }
    const parsed = JSON.parse(match[0])
    const tipo = String(parsed.tipo || '').toLowerCase()
    const isFlyer = tipo === 'flyer' ? true : tipo === 'foto' ? false : null
    let watermark = parsed.marca_de_agua
    if (
      !watermark ||
      /^(null|none|ninguna?|no|n\/a)$/i.test(String(watermark).trim())
    ) {
      watermark = null
    }
    return { isFlyer, watermark }
  } catch (error) {
    logger.warn(`Image classification failed: ${error.message}`)
    return { isFlyer: null, watermark: null, error: error.message }
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

/**
 * Print usage report
 */
export function printUsageReport() {
  logger.info('\n📊 AI Usage Report:')
  logger.info(`   Total Requests: ${usageStats.totalRequests}`)
  logger.info(`   Errors: ${usageStats.errors}`)
  logger.info(
    `   Success Rate: ${
      usageStats.totalRequests > 0
        ? (
            ((usageStats.totalRequests - usageStats.errors) /
              usageStats.totalRequests) *
            100
          ).toFixed(2)
        : 0
    }%`,
  )
}

/**
 * Reset usage stats
 */
export function resetUsageStats() {
  usageStats = {
    totalRequests: 0,
    totalTokens: 0,
    totalCost: 0,
    errors: 0,
  }
}
