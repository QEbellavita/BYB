/**
 * Tests that requireAuth and requireWorkspaceAdmin call the injected
 * AuditRecorder on their failure paths with the correct event shape.
 */
import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { requireAuth } from '../src/middleware/require-auth.js'
import { requireWorkspaceAdmin } from '../src/middleware/require-workspace-admin.js'
import type { AuditRecorder } from '../src/services/audit.js'

function makeRecorder(): { recorder: AuditRecorder; calls: unknown[] } {
  const calls: unknown[] = []
  const recorder: AuditRecorder = {
    record: vi.fn(async (e) => { calls.push(e) }),
  }
  return { recorder, calls }
}

// ── requireAuth audit wiring ──────────────────────────────────────────────────

describe('requireAuth + audit recorder', () => {
  it('calls recorder with action:auth.denied when no bearer token', async () => {
    const { recorder, calls } = makeRecorder()
    const app = express()
    app.get('/x', requireAuth({ getUser: async () => null, audit: recorder }), (_req, res) => res.json({ ok: true }))
    const res = await request(app).get('/x')
    expect(res.status).toBe(401)
    expect(calls).toHaveLength(1)
    const ev = calls[0] as Record<string, unknown>
    expect(ev.action).toBe('auth.denied')
    expect(ev.actor).toBeUndefined()
    expect(ev.metadata).toMatchObject({ method: 'GET', route: '/x' })
  })

  it('calls recorder with action:auth.denied when token is invalid', async () => {
    const { recorder, calls } = makeRecorder()
    const app = express()
    app.get('/x', requireAuth({ getUser: async () => null, audit: recorder }), (_req, res) => res.json({ ok: true }))
    const res = await request(app).get('/x').set('Authorization', 'Bearer bad-token')
    expect(res.status).toBe(401)
    expect(calls).toHaveLength(1)
    const ev = calls[0] as Record<string, unknown>
    expect(ev.action).toBe('auth.denied')
  })

  it('does NOT call recorder on success', async () => {
    const { recorder, calls } = makeRecorder()
    const app = express()
    app.get('/x', requireAuth({ getUser: async () => ({ id: 'u1', email: null }), audit: recorder }), (_req, res) => res.json({ ok: true }))
    await request(app).get('/x').set('Authorization', 'Bearer good')
    expect(calls).toHaveLength(0)
  })

  it('still 401s correctly without audit recorder (existing callers unaffected)', async () => {
    const app = express()
    app.get('/x', requireAuth({ getUser: async () => null }), (_req, res) => res.json({ ok: true }))
    const res = await request(app).get('/x')
    expect(res.status).toBe(401)
  })
})

// ── requireWorkspaceAdmin audit wiring ───────────────────────────────────────

describe('requireWorkspaceAdmin + audit recorder', () => {
  function buildApp(member: any, recorder?: AuditRecorder) {
    const app = express()
    // Stub req.user, req.workspaceId, req.member
    app.use((req: any, _res, next) => {
      req.user = { id: 'user-42', email: 'u@test.dev' }
      req.workspaceId = 'ws-99'
      req.member = member
      next()
    })
    app.get('/x', requireWorkspaceAdmin(recorder ? { audit: recorder } : undefined), (_req, res) => res.json({ ok: true }))
    return app
  }

  it('calls recorder with action:authz.denied + actor + workspace on 403 (no member)', async () => {
    const { recorder, calls } = makeRecorder()
    const app = express()
    app.use((req: any, _res, next) => {
      req.user = { id: 'user-42', email: 'u@test.dev' }
      req.workspaceId = 'ws-99'
      // no req.member
      next()
    })
    app.get('/x', requireWorkspaceAdmin({ audit: recorder }), (_req, res) => res.json({ ok: true }))
    const res = await request(app).get('/x')
    expect(res.status).toBe(403)
    expect(calls).toHaveLength(1)
    const ev = calls[0] as Record<string, unknown>
    expect(ev.action).toBe('authz.denied')
    expect(ev.actor).toBe('user-42')
    expect(ev.workspaceId).toBe('ws-99')
    expect(ev.metadata).toMatchObject({ method: 'GET', route: '/x' })
  })

  it('calls recorder with action:authz.denied when role is staff', async () => {
    const { recorder, calls } = makeRecorder()
    const app = buildApp({ role: 'staff', permissions: {} }, recorder)
    const res = await request(app).get('/x')
    expect(res.status).toBe(403)
    expect(calls).toHaveLength(1)
    expect((calls[0] as Record<string, unknown>).action).toBe('authz.denied')
    expect((calls[0] as Record<string, unknown>).actor).toBe('user-42')
    expect((calls[0] as Record<string, unknown>).workspaceId).toBe('ws-99')
  })

  it('does NOT call recorder on success (admin role)', async () => {
    const { recorder, calls } = makeRecorder()
    const app = buildApp({ role: 'admin', permissions: {} }, recorder)
    await request(app).get('/x')
    expect(calls).toHaveLength(0)
  })

  it('still 403s correctly without audit recorder (existing callers unaffected)', async () => {
    const app = buildApp({ role: 'staff', permissions: {} })
    const res = await request(app).get('/x')
    expect(res.status).toBe(403)
  })

  it('still works with no-arg call requireWorkspaceAdmin() (backward compat)', async () => {
    const app = express()
    app.use((req: any, _res, next) => {
      req.member = { role: 'admin', permissions: {} }
      next()
    })
    app.get('/x', requireWorkspaceAdmin(), (_req, res) => res.json({ ok: true }))
    const res = await request(app).get('/x')
    expect(res.status).toBe(200)
  })
})
