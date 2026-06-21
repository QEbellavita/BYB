import type { RequestHandler } from 'express'

/**
 * Minimal, dependency-free CORS for the split frontend/backend deploy.
 *
 * Auth uses Bearer tokens (not cookies), so we do not need credentialed CORS —
 * a fixed allow-origin plus the headers the SPA sends (Authorization,
 * Content-Type, x-workspace-id) is sufficient. Set `CORS_ORIGIN` to the web
 * app's origin in production (e.g. https://app.example.com); it defaults to `*`
 * for local dev where the SPA and API are on localhost.
 */
export function corsMiddleware(allowedOrigin = '*'): RequestHandler {
  return (req, res, next) => {
    res.header('Access-Control-Allow-Origin', allowedOrigin)
    if (allowedOrigin !== '*') res.header('Vary', 'Origin')
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
