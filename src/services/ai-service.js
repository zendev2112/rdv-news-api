import { GoogleGenerativeAI } from '@google/generative-ai'
import Groq from 'groq-sdk'
import config from '../config/index.js'

// Initialize both AI clients
const genAI = new GoogleGenerativeAI(config.gemini.apiKey)
const geminiModel = genAI.getGenerativeModel({ model: config.gemini.model })

const groq = new Groq({ apiKey: config.groq.apiKey })

// Track usage for logging
const usage = {
  gemini: { success: 0, failures: 0 },
  groq: { success: 0, failures: 0 },
  fallback: { success: 0, failures: 0 }
}

/**
 * Generate content with cascading fallback: Gemini → Groq → Rule-based
 */
export async function generateContent(prompt, options = {}) {
  const {
    maxRetries = 3,
    preferGroq = false, // Set to true to try Groq first
    requireJson = false, // Set to true if expecting JSON response
  } = options

  // Determine order of AIs to try
  const aiOrder = preferGroq 
    ? ['groq', 'gemini'] 
    : ['gemini', 'groq']

  let lastError = null

  // Try each AI in order
  for (const aiName of aiOrder) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Trying ${aiName} (attempt ${attempt}/${maxRetries})...`)

        let response
        if (aiName === 'gemini') {
          response = await generateWithGemini(prompt)
        } else {
          response = await generateWithGroq(prompt)
        }

        // Validate JSON if required
        if (requireJson) {
          try {
            JSON.parse(response)
          } catch (e) {
            throw new Error('Invalid JSON response')
          }
        }

        // Success!
        usage[aiName].success++
        console.log(`✅ ${aiName} succeeded`)
        return { text: response, source: aiName }

      } catch (error) {
        lastError = error
        usage[aiName].failures++
        console.warn(`❌ ${aiName} failed (attempt ${attempt}):`, error.message)

        // Don't retry on certain errors
        if (error.message.includes('Invalid API key')) {
          console.error(`${aiName} API key is invalid, skipping to next AI`)
          break // Skip to next AI
        }

        // Exponential backoff before retry
        if (attempt < maxRetries) {
          const delayMs = 1000 * Math.pow(2, attempt)
          console.log(`Waiting ${delayMs}ms before retry...`)
          await delay(delayMs)
        }
      }
    }
  }

  // Both AIs failed, return null to trigger rule-based fallback
  console.error('All AI services failed:', lastError?.message)
  usage.fallback.success++
  return { text: null, source: 'fallback', error: lastError }
}

/**
 * Generate content using Gemini
 */
async function generateWithGemini(prompt) {
  const result = await geminiModel.generateContent(prompt)
  const response = await result.response
  return response.text()
}

/**
 * Generate content using Groq
 */
async function generateWithGroq(prompt) {
  const completion = await groq.chat.completions.create({
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    model: config.groq.model,
    temperature: 0.7,
    max_tokens: 8000,
    top_p: 1,
    stream: false,
  })

  return completion.choices[0]?.message?.content || ''
}

/**
 * Get usage statistics
 */
export function getUsageStats() {
  return {
    ...usage,
    total: {
      requests: usage.gemini.success + usage.gemini.failures + 
                usage.groq.success + usage.groq.failures,
      geminiRate: (usage.gemini.success / (usage.gemini.success + usage.gemini.failures) * 100).toFixed(1) + '%',
      groqRate: (usage.groq.success / (usage.groq.success + usage.groq.failures) * 100).toFixed(1) + '%',
      fallbackRate: (usage.fallback.success / (usage.fallback.success + usage.groq.failures + usage.gemini.failures) * 100).toFixed(1) + '%'
    }
  }
}

/**
 * Print usage report
 */
export function printUsageReport() {
  const stats = getUsageStats()
  console.log('\n=== AI Usage Report ===')
  console.log(`Gemini: ${stats.gemini.success} success, ${stats.gemini.failures} failures (${stats.total.geminiRate})`)
  console.log(`Groq: ${stats.groq.success} success, ${stats.groq.failures} failures (${stats.total.groqRate})`)
  console.log(`Fallback: ${stats.fallback.success} times`)
  console.log(`Total requests: ${stats.total.requests}`)
  console.log('=======================\n')
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}