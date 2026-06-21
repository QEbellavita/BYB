import type { RequestHandler } from 'express'
import { resolvePermissions } from '../auth/rbac.js'

export function requirePermission(perm: string): RequestHandler {
  return (req, res, next) => {
    if (!req.member) return res.status(403).json({ error: 'no workspace context' })
    const perms = resolvePermissions(req.member)
    if (perms.has('*') || perms.has(perm)) return next()
    return res.status(403).json({ error: `missing permission: ${perm}` })
  }
}
