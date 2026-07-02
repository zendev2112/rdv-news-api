import { PostHog } from 'posthog-node'
import logger from '../utils/logger.js'

/**
 * PostHog analytics for the news pipeline.
 *
 * Two jobs:
 *   1. Product analytics — capture pipeline events (article generated, review
 *      verdict) so the fetch→generate→review→publish funnel and the gate's
 *      verdict breakdown are live dashboards instead of a hand-run script.
 *   2. Feature flags — a kill-switch / gradual-rollout gate for the risky
 *      autonomous action (auto-publish), evaluated server-side.
 *
 * Design rules:
 *   - NEVER break the pipeline. If POSTHOG_API_KEY is unset or PostHog is down,
 *     every function degrades to a safe no-op (flags fall back to a default).
 *   - Serverless-safe. Vercel freezes the process after the handler returns, so
 *     buffered events silently drop unless flushed. Callers MUST `await flush()`
 *     before returning; we also keep flushAt low so bursts leave early.
 *
 * A single system actor identifies the pipeline: there is no human "user", so we
 * attribute every event to distinctId "rdv-pipeline" and put section/source/etc.
 * in properties (that's where you slice the dashboards).
 */

const SYSTEM_DISTINCT_ID = 'rdv-pipeline'
const HOST = process.env.POSTHOG_HOST || 'https://us.i.posthog.com'

let _client = null
let _initialized = false

function client() {
  if (_initialized) return _client
  _initialized = true
  const apiKey = process.env.POSTHOG_API_KEY
  if (!apiKey) {
    logger.info('📊 PostHog disabled (POSTHOG_API_KEY not set) — analytics no-op')
    _client = null
    return null
  }
  _client = new PostHog(apiKey, {
    host: HOST,
    // Small buffer: in short-lived serverless/cron runs we want events to leave
    // quickly, and every handler flushes explicitly before returning anyway.
    flushAt: 10,
    flushInterval: 5000,
  })
  logger.info(`📊 PostHog enabled → ${HOST}`)
  return _client
}

/**
 * Capture a pipeline event. Fire-and-forget; never throws.
 * @param {string} event       e.g. 'article_generated', 'review_verdict'
 * @param {object} [properties] dimensions to slice on (section, source, verdict…)
 */
export function capture(event, properties = {}) {
  try {
    const c = client()
    if (!c) return
    c.capture({ distinctId: SYSTEM_DISTINCT_ID, event, properties })
  } catch (err) {
    logger.warn(`📊 PostHog capture("${event}") failed: ${err.message}`)
  }
}

/**
 * Evaluate a boolean feature flag, server-side. Falls back to `fallback` if
 * PostHog is unconfigured, errors, or returns undefined — so a dead analytics
 * service can never accidentally flip an autonomous action on.
 * @param {string} flagKey
 * @param {boolean} [fallback=false]
 * @returns {Promise<boolean>}
 */
export async function isFeatureEnabled(flagKey, fallback = false) {
  try {
    const c = client()
    if (!c) return fallback
    const enabled = await c.isFeatureEnabled(flagKey, SYSTEM_DISTINCT_ID)
    return typeof enabled === 'boolean' ? enabled : fallback
  } catch (err) {
    logger.warn(`📊 PostHog flag "${flagKey}" failed, using fallback ${fallback}: ${err.message}`)
    return fallback
  }
}

/**
 * Is autonomous publishing turned on? Gates step 2's publish path. Defaults to
 * FALSE (fail-safe): unless someone explicitly enables the 'auto-publish' flag
 * in PostHog, drafts are never auto-published.
 * @returns {Promise<boolean>}
 */
export function isAutoPublishEnabled() {
  return isFeatureEnabled('auto-publish', false)
}

/**
 * Flush buffered events. Call (and await) before a serverless handler returns.
 * Safe to call when disabled. Never throws.
 */
export async function flush() {
  try {
    const c = client()
    if (!c) return
    await c.flush()
  } catch (err) {
    logger.warn(`📊 PostHog flush failed: ${err.message}`)
  }
}

/** Flush + close the client (for long-lived scripts that then exit). */
export async function shutdown() {
  try {
    const c = client()
    if (!c) return
    await c.shutdown()
  } catch (err) {
    logger.warn(`📊 PostHog shutdown failed: ${err.message}`)
  }
}

export default {
  capture,
  isFeatureEnabled,
  isAutoPublishEnabled,
  flush,
  shutdown,
}
