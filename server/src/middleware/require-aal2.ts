import type { RequestHandler } from 'express'
import type { AuditRecorder } from '../services/audit.js'

export function requireAAL2(opts?: { audit?: AuditRecorder }): RequestHandler {
  return (req, res, next) => {
    if (req.aal === 'aal2') return next()
    void opts?.audit?.record({
      workspaceId: req.workspaceId ?? null,
      actor: req.user?.id ?? null,
      action: 'mfa.required',
      metadata: {
        ip: req.ip,
        route: req.path,
        method: req.method,
        requestId: (req.headers['x-request-id'] as string | undefined) ?? null,
      },
    })
    res.status(403).json({ error: 'MFA required', code: 'mfa_required' })
  }
}
