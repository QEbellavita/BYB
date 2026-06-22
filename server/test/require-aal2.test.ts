import { describe, it, expect, vi } from 'vitest'
import express, { type Request, type Response, type NextFunction } from 'express'
import request from 'supertest'
import { requireAAL2 } from '../src/middleware/require-aal2.js'
import type { AuditRecorder } from '../src/services/audit.js'

function buildApp(aal: 'aal1' | 'aal2' | null, audit?: AuditRecorder) {
  const app = express()

  // Inject aal + workspaceId + user onto req (simulates requireAuth having already run)
  app.use((req: Request, _res: Response, next: NextFunction) => {
    ;(req as Request & { aal: typeof aal }).aal = aal
    ;(req as Request & { workspaceId?: string }).workspaceId = 'ws-1'
    ;(req as Request & { user?: { id: string; email: string | null } }).user = { id: 'u1', email: 'u@test.dev' }
    next()
  })

  app.get('/protected', requireAAL2({ audit }), (_req, res) => {
    res.status(200).json({ ok: true })
  })

  return app
}

describe('requireAAL2', () => {
  it('returns 403 with code mfa_required when aal is aal1', async () => {
    const res = await request(buildApp('aal1')).get('/protected')
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('mfa_required')
  })

  it('calls next() (200) when aal is aal2', async () => {
    const res = await request(buildApp('aal2')).get('/protected')
    expect(res.status).toBe(200)
  })

  it('fires audit record with action mfa.required on aal1 request', async () => {
    const audit: AuditRecorder = { record: vi.fn().mockResolvedValue(undefined) }
    await request(buildApp('aal1', audit)).get('/protected')
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'mfa.required' })
    )
  })

  it('does NOT fire audit record when aal is aal2', async () => {
    const audit: AuditRecorder = { record: vi.fn().mockResolvedValue(undefined) }
    await request(buildApp('aal2', audit)).get('/protected')
    expect(audit.record).not.toHaveBeenCalled()
  })
})
