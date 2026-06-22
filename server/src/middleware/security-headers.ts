import type { RequestHandler } from 'express'

/**
 * Hand-rolled security headers for the JSON API (dependency-free, like cors.ts).
 * HSTS is only honoured over HTTPS and is gated to production to avoid surprising
 * local/test behaviour. CORP is intentionally NOT set — it would break the SPA's
 * legitimate cross-origin fetch; CORS governs cross-origin access.
 */
export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
    }
    next()
  }
}
