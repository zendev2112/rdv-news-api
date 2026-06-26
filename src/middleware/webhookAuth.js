import logger from '../utils/logger.js'

/**
 * Auth guard for the Airtable publish webhooks.
 *
 * These endpoints write to the live site (Supabase articles + the Redes Sociales
 * table), so they must not be callable by anyone who knows the URL. Accepts
 * either credential, both already conventions in this codebase:
 *
 *   - Authorization: Bearer <ADMIN_API_TOKEN>      (same token the api/* functions
 *                                                    and admin.html use — preferred
 *                                                    for the agent/cron caller)
 *   - x-automation-secret: <AIRTABLE_AUTOMATION_SECRET>  (matches the existing
 *                                                    /webhooks/status-change guard)
 *
 * Fails closed: if neither secret is configured server-side, every request is
 * rejected (a misconfiguration must never silently leave the endpoint open).
 */
export function requireWebhookAuth(req, res, next) {
  // CORS preflight is handled by the global cors() middleware, but guard anyway.
  if (req.method === 'OPTIONS') return next()

  const adminToken = process.env.ADMIN_API_TOKEN
  const automationSecret = process.env.AIRTABLE_AUTOMATION_SECRET

  if (!adminToken && !automationSecret) {
    logger.error(
      'Webhook auth misconfigured: neither ADMIN_API_TOKEN nor AIRTABLE_AUTOMATION_SECRET is set',
    )
    return res
      .status(500)
      .json({ success: false, error: 'Server auth not configured' })
  }

  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  const secretHeader = req.headers['x-automation-secret']

  const bearerOk = adminToken && bearer === adminToken
  const secretOk = automationSecret && secretHeader === automationSecret

  if (bearerOk || secretOk) return next()

  logger.warn(
    `Unauthorized webhook attempt on ${req.originalUrl} from ${req.ip || 'unknown'}`,
  )
  return res.status(401).json({ success: false, error: 'Unauthorized' })
}

export default requireWebhookAuth
