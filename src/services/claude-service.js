import Anthropic from '@anthropic-ai/sdk'
import logger from '../utils/logger.js'

/**
 * Anthropic / Claude wrapper for the editorial review gate.
 *
 * Gemini stays the generator; Claude is used only for judgment. Review work is
 * not latency-sensitive (a cron picks up drafts on its own schedule), so it goes
 * through the Message Batches API — same models, 50% cheaper on every token.
 *
 * Requires ANTHROPIC_API_KEY. Defaults to Sonnet 4.6 for the lean shadow gate;
 * override with CLAUDE_REVIEW_MODEL.
 */

export const REVIEW_MODEL = process.env.CLAUDE_REVIEW_MODEL || 'claude-sonnet-4-6'

let _client = null
function client() {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
    _client = new Anthropic({ apiKey })
  }
  return _client
}

/**
 * One synchronous message — used for the health probe and any non-batched path.
 * @returns {Promise<string>} the assistant's text
 */
export async function generateMessage({
  system,
  prompt,
  model = REVIEW_MODEL,
  maxTokens = 1024,
}) {
  const res = await client().messages.create({
    model,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages: [{ role: 'user', content: prompt }],
  })
  return res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
}

/**
 * Cheap liveness probe for the Anthropic key. Mirrors checkGeminiHealth so the
 * review cron can abort loudly instead of silently doing nothing.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function checkAnthropicHealth() {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return { ok: false, error: 'ANTHROPIC_API_KEY is not set' }
    }
    const text = await generateMessage({
      prompt: 'Reply with exactly: OK',
      maxTokens: 8,
    })
    if (!text) return { ok: false, error: 'Claude returned an empty response' }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

/**
 * Submit a Message Batch.
 * @param {Array<{custom_id: string, params: object}>} requests
 * @returns {Promise<object>} the created batch (has .id, .processing_status)
 */
export async function submitBatch(requests) {
  if (!requests?.length) throw new Error('submitBatch: no requests')
  const batch = await client().messages.batches.create({ requests })
  logger.info(
    `📤 Submitted Claude batch ${batch.id} (${requests.length} requests)`,
  )
  return batch
}

/**
 * List recent Message Batches (most recent first).
 * @param {number} limit
 * @returns {Promise<Array<object>>}
 */
export async function listBatches(limit = 20) {
  const out = []
  for await (const b of client().messages.batches.list({ limit })) {
    out.push(b)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Stream the results of an ended batch.
 * @param {string} batchId
 * @returns {Promise<Array<{custom_id: string, result: object}>>}
 */
export async function getBatchResults(batchId) {
  const out = []
  for await (const r of client().messages.batches.results(batchId)) {
    out.push(r)
  }
  return out
}

/**
 * Pull the assistant text out of a single batch result entry, or null if the
 * request errored / was cancelled / expired.
 */
export function textFromResult(result) {
  if (result?.result?.type !== 'succeeded') return null
  const msg = result.result.message
  if (!msg?.content) return null
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
}

export default {
  REVIEW_MODEL,
  generateMessage,
  checkAnthropicHealth,
  submitBatch,
  listBatches,
  getBatchResults,
  textFromResult,
}
