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
import { createOnboardingRouter } from '../src/modules/onboarding/routes.js'
import type { OnboardingRouterDeps } from '../src/modules/onboarding/routes.js'

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

// ── createOnboardingRouter — production audit wiring end-to-end ──────────────

describe('createOnboardingRouter + audit recorder — authz.denied fires through router', () => {
  function makeRecorder(): { recorder: AuditRecorder; calls: unknown[] } {
    const calls: unknown[] = []
    const recorder: AuditRecorder = {
      record: vi.fn(async (e) => { calls.push(e) }),
    }
    return { recorder, calls }
  }

  function buildRouterApp(memberRole: string, recorder: AuditRecorder) {
    // Minimal stub implementations — only enough for the middleware chain
    const deps: OnboardingRouterDeps = {
      auth: {
        getUser: async () => ({ id: 'user-router-test', email: 'test@example.com' }),
      },
      workspace: {
        getMembership: async (_token, _wsId) => ({ role: memberRole, permissions: {} }),
      },
      makeService: (_token) => ({
        load: vi.fn(),
        saveProfile: vi.fn(),
        saveRules: vi.fn(),
        saveIndustry: vi.fn(),
        savePeople: vi.fn(),
        finish: vi.fn(),
        retryInvitation: vi.fn(),
      } as any),
      makeOnboardingStore: (_token) => ({
        createSession: vi.fn(),
        getSession: vi.fn(),
        updateProgress: vi.fn(),
        listInviteDrafts: vi.fn(),
        reconcileInviteDrafts: vi.fn(),
        markInviteDelivery: vi.fn(),
      } as any),
      createWorkspace: vi.fn(),
      audit: recorder,
    }

    const app = express()
    app.use(express.json())
    app.use(createOnboardingRouter(deps))
    return app
  }

  it('403 on PUT /profile with non-admin role AND spy recorder receives authz.denied', async () => {
    const { recorder, calls } = makeRecorder()
    const app = buildRouterApp('member', recorder)

    const res = await request(app)
      .put('/profile')
      .set('Authorization', 'Bearer valid-token')
      .set('x-workspace-id', 'ws-abc')
      .set('x-request-id', 'req-xyz-123')
      .send({ name: 'Test' })

    expect(res.status).toBe(403)
    // Allow micro-task flush so the fire-and-forget void Promise resolves
    await new Promise((r) => setTimeout(r, 10))
    expect(calls).toHaveLength(1)
    const ev = calls[0] as Record<string, unknown>
    expect(ev.action).toBe('authz.denied')
    expect(ev.actor).toBe('user-router-test')
    expect(ev.workspaceId).toBe('ws-abc')
    const meta = ev.metadata as Record<string, unknown>
    expect(meta.requestId).toBe('req-xyz-123')
  })

  it('does NOT fire authz.denied when user is admin', async () => {
    const { recorder, calls } = makeRecorder()
    // saveProfile will throw since store returns undefined, but that's fine — we just want no audit event
    const app = buildRouterApp('admin', recorder)

    await request(app)
      .put('/profile')
      .set('Authorization', 'Bearer valid-token')
      .set('x-workspace-id', 'ws-abc')
      .set('x-request-id', 'req-xyz-admin')
      .send({ name: 'Test' })

    await new Promise((r) => setTimeout(r, 10))
    // No authz.denied — request passed the guard (may 500 from missing store, but no audit event)
    const authzCalls = (calls as Array<Record<string, unknown>>).filter(e => e.action === 'authz.denied')
    expect(authzCalls).toHaveLength(0)
  })
})
