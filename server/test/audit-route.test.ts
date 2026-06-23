import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { auditRouter } from '../src/routes/audit.js'
import type { AppConfig } from '../src/config.js'
import type { AuditRecorder } from '../src/services/audit.js'

// ---------------------------------------------------------------------------
// Fake config (not used to make real DB calls — we inject the client via mock)
// ---------------------------------------------------------------------------
const fakeConfig: AppConfig = {
  supabaseUrl: 'http://localhost:54321',
  supabaseAnonKey: 'anon-key',
  supabaseServiceRoleKey: 'service-role-key',
}

// ---------------------------------------------------------------------------
// Token helpers — craft a real-shaped JWT with a specific aal claim so that
// requireAuth can parse req.aal from the token payload (base64url segment 2).
// ---------------------------------------------------------------------------

function makeToken(aal: 'aal1' | 'aal2' | null): string {
  const payload = aal ? { sub: 'user-1', aal } : { sub: 'user-1' }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  // header.payload.sig — signature is ignored in unit tests (getUser is faked)
  return `eyJhbGciOiJIUzI1NiJ9.${encoded}.fakesig`
}

const AAL2_TOKEN = makeToken('aal2')
const AAL1_TOKEN = makeToken('aal1')

// ---------------------------------------------------------------------------
// Fake audit-log store builder
// Captures the calls made so we can assert on limit / before filter
// ---------------------------------------------------------------------------

interface FakeStoreCall {
  workspaceId: string
  limit: number
  before?: number
}

function makeQueryBuilder(rows: Record<string, unknown>[], capturedCalls: FakeStoreCall[], workspaceId: string) {
  let _limit = 50
  let _before: number | undefined

  const builder: Record<string, unknown> = {}

  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn((_col: string, _val: unknown) => builder)
  builder.order = vi.fn(() => builder)
  builder.limit = vi.fn((n: number) => {
    _limit = n
    return builder
  })
  builder.lt = vi.fn((_col: string, val: number) => {
    _before = val
    return builder
  })

  // When awaited, resolve with fake rows
  // vitest fake: make the builder thenable
  ;(builder as unknown as Promise<unknown>)[Symbol.toStringTag] = 'Promise'
  ;(builder as unknown as { then: Function }).then = (resolve: Function) => {
    capturedCalls.push({ workspaceId, limit: _limit, before: _before })
    return Promise.resolve({ data: rows, error: null }).then(resolve)
  }

  return builder
}

function buildApp(rows: Record<string, unknown>[], capturedCalls: FakeStoreCall[], userRole = 'owner', audit?: AuditRecorder) {
  const app = express()
  app.use(express.json())

  // Fake auth that always resolves to a user
  const fakeAuth = {
    getUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'admin@test.com' }),
  }
  // Fake membership
  const fakeMembership = {
    getMembership: vi.fn().mockResolvedValue({ role: userRole, permissions: {} }),
  }

  // Patch userScopedClient to return a fake Supabase client
  // We create the router and inject a fake by monkey-patching the module
  // Instead: we build the router with an injected fake client factory
  const router = auditRouter(fakeConfig, {
    auth: fakeAuth,
    workspace: fakeMembership,
    audit,
    makeClient: (_config: AppConfig, _token: string) => ({
      from: (_table: string) => makeQueryBuilder(rows, capturedCalls, 'ws-1'),
    }),
  })

  app.use('/api/audit', router)
  return app
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/audit — admin gets entries', () => {
  it('returns 200 with { entries, nextCursor } for an admin with aal2', async () => {
    const rows = [
      { id: 5, workspace_id: 'ws-1', actor: 'user-1', action: 'risk.created', created_at: '2024-01-01T00:00:00Z' },
      { id: 3, workspace_id: 'ws-1', actor: 'user-1', action: 'risk.updated', created_at: '2024-01-01T00:00:00Z' },
    ]
    const calls: FakeStoreCall[] = []
    const app = buildApp(rows, calls)

    const res = await request(app)
      .get('/api/audit')
      .set('authorization', `Bearer ${AAL2_TOKEN}`)
      .set('x-workspace-id', 'ws-1')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ entries: expect.any(Array), nextCursor: 3 })
    expect(res.body.entries).toHaveLength(2)
  })

  it('returns 403 mfa_required for an admin with aal1 (no MFA)', async () => {
    const rows = [
      { id: 5, workspace_id: 'ws-1', actor: 'user-1', action: 'risk.created', created_at: '2024-01-01T00:00:00Z' },
    ]
    const calls: FakeStoreCall[] = []
    const app = buildApp(rows, calls)

    const res = await request(app)
      .get('/api/audit')
      .set('authorization', `Bearer ${AAL1_TOKEN}`)
      .set('x-workspace-id', 'ws-1')

    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({ code: 'mfa_required' })
  })

  it('returns nextCursor: null when entries is empty (aal2)', async () => {
    const calls: FakeStoreCall[] = []
    const app = buildApp([], calls)

    const res = await request(app)
      .get('/api/audit')
      .set('authorization', `Bearer ${AAL2_TOKEN}`)
      .set('x-workspace-id', 'ws-1')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ entries: [], nextCursor: null })
  })
})

describe('GET /api/audit — non-admin gets 403', () => {
  it('returns 403 for a member with role "staff"', async () => {
    const calls: FakeStoreCall[] = []
    const app = buildApp([], calls, 'staff')

    const res = await request(app)
      .get('/api/audit')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')

    expect(res.status).toBe(403)
  })

  it('returns 403 for a member with role "member"', async () => {
    const calls: FakeStoreCall[] = []
    const app = buildApp([], calls, 'member')

    const res = await request(app)
      .get('/api/audit')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')

    expect(res.status).toBe(403)
  })
})

describe('GET /api/audit — ?limit clamped to 200', () => {
  it('clamps ?limit=999 to 200', async () => {
    const calls: FakeStoreCall[] = []
    const app = buildApp([], calls)

    await request(app)
      .get('/api/audit?limit=999')
      .set('authorization', `Bearer ${AAL2_TOKEN}`)
      .set('x-workspace-id', 'ws-1')

    expect(calls[0]?.limit).toBe(200)
  })

  it('respects ?limit=10', async () => {
    const calls: FakeStoreCall[] = []
    const app = buildApp([], calls)

    await request(app)
      .get('/api/audit?limit=10')
      .set('authorization', `Bearer ${AAL2_TOKEN}`)
      .set('x-workspace-id', 'ws-1')

    expect(calls[0]?.limit).toBe(10)
  })

  it('defaults to 50 when no limit is set', async () => {
    const calls: FakeStoreCall[] = []
    const app = buildApp([], calls)

    await request(app)
      .get('/api/audit')
      .set('authorization', `Bearer ${AAL2_TOKEN}`)
      .set('x-workspace-id', 'ws-1')

    expect(calls[0]?.limit).toBe(50)
  })
})

describe('GET /api/audit — ?limit validation (400 for invalid values)', () => {
  it('returns 400 for ?limit=-1 (negative integer)', async () => {
    const calls: FakeStoreCall[] = []
    const app = buildApp([], calls)

    const res = await request(app)
      .get('/api/audit?limit=-1')
      .set('authorization', `Bearer ${AAL2_TOKEN}`)
      .set('x-workspace-id', 'ws-1')

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: '?limit must be a positive integer' })
  })

  it('returns 400 for ?limit=foo (non-numeric)', async () => {
    const calls: FakeStoreCall[] = []
    const app = buildApp([], calls)

    const res = await request(app)
      .get('/api/audit?limit=foo')
      .set('authorization', `Bearer ${AAL2_TOKEN}`)
      .set('x-workspace-id', 'ws-1')

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: '?limit must be a positive integer' })
  })
})

describe('GET /api/audit — ?before cursor', () => {
  it('passes ?before=123 as a lt filter on id', async () => {
    const calls: FakeStoreCall[] = []
    const app = buildApp([], calls)

    await request(app)
      .get('/api/audit?before=123')
      .set('authorization', `Bearer ${AAL2_TOKEN}`)
      .set('x-workspace-id', 'ws-1')

    expect(calls[0]?.before).toBe(123)
  })

  it('does not apply lt filter when ?before is absent', async () => {
    const calls: FakeStoreCall[] = []
    const app = buildApp([], calls)

    await request(app)
      .get('/api/audit')
      .set('authorization', `Bearer ${AAL2_TOKEN}`)
      .set('x-workspace-id', 'ws-1')

    expect(calls[0]?.before).toBeUndefined()
  })
})

describe('GET /api/audit — ?before validation (400 for invalid values)', () => {
  it('returns 400 for ?before=foo (non-numeric)', async () => {
    const calls: FakeStoreCall[] = []
    const app = buildApp([], calls)

    const res = await request(app)
      .get('/api/audit?before=foo')
      .set('authorization', `Bearer ${AAL2_TOKEN}`)
      .set('x-workspace-id', 'ws-1')

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: '?before must be a positive integer' })
  })

  it('returns 400 for ?before=-1 (negative integer)', async () => {
    const calls: FakeStoreCall[] = []
    const app = buildApp([], calls)

    const res = await request(app)
      .get('/api/audit?before=-1')
      .set('authorization', `Bearer ${AAL2_TOKEN}`)
      .set('x-workspace-id', 'ws-1')

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: '?before must be a positive integer' })
  })

  it('returns 400 for ?before=0 (zero is not positive)', async () => {
    const calls: FakeStoreCall[] = []
    const app = buildApp([], calls)

    const res = await request(app)
      .get('/api/audit?before=0')
      .set('authorization', `Bearer ${AAL2_TOKEN}`)
      .set('x-workspace-id', 'ws-1')

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: '?before must be a positive integer' })
  })
})

describe('GET /api/audit — audit recorder wired through router', () => {
  function makeRecorder(): { recorder: AuditRecorder; calls: unknown[] } {
    const calls: unknown[] = []
    const recorder: AuditRecorder = {
      record: vi.fn(async (e) => { calls.push(e) }),
    }
    return { recorder, calls }
  }

  it('403 for non-admin AND spy recorder receives action:authz.denied', async () => {
    const { recorder, calls } = makeRecorder()
    const capturedCalls: FakeStoreCall[] = []
    const app = buildApp([], capturedCalls, 'staff', recorder)

    const res = await request(app)
      .get('/api/audit')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .set('x-request-id', 'req-audit-test-1')

    expect(res.status).toBe(403)
    // Allow micro-task flush so the fire-and-forget void Promise resolves
    await new Promise((r) => setTimeout(r, 10))
    expect(calls).toHaveLength(1)
    const ev = calls[0] as Record<string, unknown>
    expect(ev.action).toBe('authz.denied')
    expect(ev.actor).toBe('user-1')
    expect(ev.workspaceId).toBe('ws-1')
  })

  it('does NOT fire authz.denied when user is admin with aal2 (owner role)', async () => {
    const { recorder, calls } = makeRecorder()
    const capturedCalls: FakeStoreCall[] = []
    const app = buildApp([], capturedCalls, 'owner', recorder)

    await request(app)
      .get('/api/audit')
      .set('authorization', `Bearer ${AAL2_TOKEN}`)
      .set('x-workspace-id', 'ws-1')

    await new Promise((r) => setTimeout(r, 10))
    const authzCalls = (calls as Array<Record<string, unknown>>).filter(e => e.action === 'authz.denied')
    expect(authzCalls).toHaveLength(0)
  })

  it('fires mfa.required audit event when admin has aal1', async () => {
    const { recorder, calls } = makeRecorder()
    const capturedCalls: FakeStoreCall[] = []
    const app = buildApp([], capturedCalls, 'owner', recorder)

    const res = await request(app)
      .get('/api/audit')
      .set('authorization', `Bearer ${AAL1_TOKEN}`)
      .set('x-workspace-id', 'ws-1')
      .set('x-request-id', 'req-aal1-test-1')

    expect(res.status).toBe(403)
    await new Promise((r) => setTimeout(r, 10))
    const mfaCalls = (calls as Array<Record<string, unknown>>).filter(e => e.action === 'mfa.required')
    expect(mfaCalls).toHaveLength(1)
  })
})
