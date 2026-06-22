import type { RequestHandler } from 'express'
import type { AuditRecorder } from '../services/audit.js'

export interface RequireWorkspaceAdminOpts {
  audit?: AuditRecorder
}

export function requireWorkspaceAdmin(opts?: RequireWorkspaceAdminOpts): RequestHandler {
  return (req, res, next) => {
    if (!req.member) {
      void opts?.audit?.record({
        action: 'authz.denied',
        actor: req.user?.id ?? null,
        workspaceId: req.workspaceId ?? null,
        metadata: { ip: req.ip, route: req.path, method: req.method, requestId: (req.headers['x-request-id'] as string | undefined) ?? null },
      })
      return res.status(403).json({ error: 'no workspace context' })
    }
    if (req.member.role !== 'owner' && req.member.role !== 'admin') {
      void opts?.audit?.record({
        action: 'authz.denied',
        actor: req.user?.id ?? null,
        workspaceId: req.workspaceId ?? null,
        metadata: { ip: req.ip, route: req.path, method: req.method, requestId: (req.headers['x-request-id'] as string | undefined) ?? null },
      })
      return res.status(403).json({ error: 'owner or admin required' })
    }
    next()
  }
}
