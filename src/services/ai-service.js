import { GoogleGenerativeAI } from '@google/generative-ai'
import Groq from 'groq-sdk'
import axios from 'axios'
import config from '../config/index.js'

// Initialize Gemini
const genAI = new GoogleGenerativeAI(config.gemini.apiKey)
const geminiModel = genAI.getGenerativeModel({ model: config.gemini.model })

// Initialize Groq
const groq = new Groq({ apiKey: config.groq.apiKey })

// Track usage for logging
const usage = {
  gemini: { success: 0, failures: 0 },
  groq: { success: 0, failures: 0 },
  huggingface: { success: 0, failures: 0 },
  cerebras: { success: 0, failures: 0 },
  openrouter: { success: 0, failures: 0 },
  fallback: { success: 0, failures: 0 },
}

/**
 * Generate content with cascading fallback: Gemini → Groq → HuggingFace → Cerebras → OpenRouter → Rule-based
 */
export async function generateContent(prompt, options = {}) {
  const {
    maxRetries = 3,
    preferGroq = false,
    requireJson = false,
  } = options

  // Determine order of AIs to try
  const aiOrder = preferGroq
    ? ['groq', 'gemini', 'cerebras', 'openrouter']
    : ['gemini', 'groq', 'cerebras', 'openrouter']

  let lastError = null

  // Try each AI in order
  for (const aiName of aiOrder) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Trying ${aiName} (attempt ${attempt}/${maxRetries})...`)

        let response
        switch (aiName) {
          case 'gemini':
            response = await generateWithGemini(prompt)
            break
          case 'groq':
            response = await generateWithGroq(prompt)
            break
          case 'huggingface':
            response = await generateWithHuggingFace(prompt)
            break
          case 'cerebras':
            response = await generateWithCerebras(prompt)
            break
          case 'openrouter':
            response = await generateWithOpenRouter(prompt)
            break
          default:
            throw new Error(`Unknown AI: ${aiName}`)
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
        console.warn(
          `❌ ${aiName} failed (attempt ${attempt}/${maxRetries}):`,
          error.message
        )

        // Don't retry on certain errors
        if (
          error.message.includes('Invalid API key') ||
          error.message.includes('401') ||
          error.message.includes('403')
        ) {
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

  // All AIs failed, return null to trigger rule-based fallback
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
 * Generate content using HuggingFace Inference API
 */
async function generateWithHuggingFace(prompt) {
  const apiKey = config.huggingface?.apiKey || process.env.HUGGINGFACE_API_KEY
  if (!apiKey) {
    throw new Error('HuggingFace API key not configured')
  }

  const model = config.huggingface?.model || 'meta-llama/Llama-2-70b-chat-hf'

  const response = await axios.post(
    `https://api-inference.huggingface.co/models/${model}`,
    {
      inputs: prompt,
      parameters: {
        max_new_tokens: 8000,
        temperature: 0.7,
        top_p: 0.95,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 30000,
    }
  )

  if (Array.isArray(response.data)) {
    return response.data[0]?.generated_text || ''
  }

  return response.data?.generated_text || ''
}

/**
 * Generate content using Cerebras API
 */
async function generateWithCerebras(prompt) {
  const apiKey = config.cerebras?.apiKey || process.env.CEREBRAS_API_KEY
  if (!apiKey) {
    throw new Error('Cerebras API key not configured')
  }

  const model = config.cerebras?.model || 'cpt-7b'

  const response = await axios.post(
    'https://api.cerebras.ai/v1/chat/completions',
    {
      model: model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 8000,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  )

  return response.data?.choices?.[0]?.message?.content || ''
}

/**
 * Generate content using OpenRouter API
 */
async function generateWithOpenRouter(prompt) {
  const apiKey = config.openrouter?.apiKey || process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error('OpenRouter API key not configured')
  }

  const model = config.openrouter?.model || 'meta-llama/llama-2-70b-chat'

  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 8000,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.OPENROUTER_REFERRER || 'http://localhost',
        'X-Title': 'RDV News API',
      },
      timeout: 30000,
    }
  )

  return response.data?.choices?.[0]?.message?.content || ''
}

/**
 * Get usage statistics
 */
export function getUsageStats() {
  const totalRequests =
    Object.values(usage).reduce((sum, ai) => sum + ai.success + ai.failures, 0) -
    usage.fallback.success

  return {
    ...usage,
    total: {
      requests: totalRequests,
      geminiRate:
        usage.gemini.success + usage.gemini.failures > 0
          ? (
              (usage.gemini.success /
                (usage.gemini.success + usage.gemini.failures)) *
              100
            ).toFixed(1) + '%'
          : 'N/A',
      groqRate:
        usage.groq.success + usage.groq.failures > 0
          ? (
              (usage.groq.success / (usage.groq.success + usage.groq.failures)) *
              100
            ).toFixed(1) + '%'
          : 'N/A',
      huggingfaceRate:
        usage.huggingface.success + usage.huggingface.failures > 0
          ? (
              (usage.huggingface.success /
                (usage.huggingface.success + usage.huggingface.failures)) *
              100
            ).toFixed(1) + '%'
          : 'N/A',
      cerebrasRate:
        usage.cerebras.success + usage.cerebras.failures > 0
          ? (
              (usage.cerebras.success /
                (usage.cerebras.success + usage.cerebras.failures)) *
              100
            ).toFixed(1) + '%'
          : 'N/A',
      openrouterRate:
        usage.openrouter.success + usage.openrouter.failures > 0
          ? (
              (usage.openrouter.success /
                (usage.openrouter.success + usage.openrouter.failures)) *
              100
            ).toFixed(1) + '%'
          : 'N/A',
      fallbackRate:
        usage.fallback.success > 0 ? usage.fallback.success + ' times' : 'N/A',
    },
  }
}

/**
 * Print usage report
 */
export function printUsageReport() {
  const stats = getUsageStats()
  console.log('\n╔════════════════════════════════════════════════════════════╗')
  console.log('║               AI USAGE REPORT - ALL PROVIDERS              ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(
    `║ Gemini:       ${String(stats.gemini.success).padEnd(5)} success, ${String(stats.gemini.failures).padEnd(5)} failures (${String(stats.total.geminiRate).padEnd(6)}) ║`
  )
  console.log(
    `║ Groq:         ${String(stats.groq.success).padEnd(5)} success, ${String(stats.groq.failures).padEnd(5)} failures (${String(stats.total.groqRate).padEnd(6)}) ║`
  )
  console.log(
    `║ HuggingFace:  ${String(stats.huggingface.success).padEnd(5)} success, ${String(stats.huggingface.failures).padEnd(5)} failures (${String(stats.total.huggingfaceRate).padEnd(6)}) ║`
  )
  console.log(
    `║ Cerebras:     ${String(stats.cerebras.success).padEnd(5)} success, ${String(stats.cerebras.failures).padEnd(5)} failures (${String(stats.total.cerebrasRate).padEnd(6)}) ║`
  )
  console.log(
    `║ OpenRouter:   ${String(stats.openrouter.success).padEnd(5)} success, ${String(stats.openrouter.failures).padEnd(5)} failures (${String(stats.total.openrouterRate).padEnd(6)}) ║`
  )
  console.log(`║ Rule-based Fallback: ${String(stats.fallback.success).padEnd(5)} times                            ║`)
  console.log(`║ Total Requests: ${String(stats.total.requests).padEnd(45)} ║`)
  console.log('╚════════════════════════════════════════════════════════════╝\n')
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}