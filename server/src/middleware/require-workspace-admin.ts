import type { RequestHandler } from 'express'

export function requireWorkspaceAdmin(): RequestHandler {
  return (req, res, next) => {
    if (!req.member) return res.status(403).json({ error: 'no workspace context' })
    if (req.member.role !== 'owner' && req.member.role !== 'admin') {
      return res.status(403).json({ error: 'owner or admin required' })
    }
    next()
  }
}
