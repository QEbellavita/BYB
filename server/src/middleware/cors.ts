import type { RequestHandler } from 'express'

/**
 * Minimal, dependency-free CORS for the split frontend/backend deploy.
 *
 * Auth uses Bearer tokens (not cookies), so we do not need credentialed CORS.
 *
 * `originSpec` is the raw CORS_ORIGIN env value — a comma-separated allowlist
 * of origins (e.g. "https://app.example.com,https://preview.example.com"),
 * or "*" / undefined for local dev (allows all origins).
 *
 * In production, passing "*" or leaving it unset will emit a console warning.
 */
export function corsMiddleware(originSpec = '*'): RequestHandler {
  const allowList = originSpec.split(',').map((s) => s.trim()).filter(Boolean)
  const allowAll = allowList.length === 0 || allowList.includes('*')
  if (allowAll && process.env.NODE_ENV === 'production') {
    console.warn('[cors] CORS_ORIGIN is "*" (or unset) in production — set an explicit allowlist')
  }
  return (req, res, next) => {
    const origin = req.headers.origin
    if (allowAll) {
      res.header('Access-Control-Allow-Origin', '*')
    } else if (origin && allowList.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin)
      res.header('Vary', 'Origin')
    }
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-workspace-id')
    res.header('Access-Control-Max-Age', '86400')
    if (req.method === 'OPTIONS') {
      res.sendStatus(204)
      return
    }
    next()
  }
}
