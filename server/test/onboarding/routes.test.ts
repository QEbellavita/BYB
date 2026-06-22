import { describe, it, expect, vi, beforeEach } from 'vitest'
import express, { type Router } from 'express'
import request from 'supertest'
import type { OnboardingService, OnboardingStore, OnboardingSession, OnboardingSnapshot, FinishResult } from '../../src/modules/onboarding/types.js'
import type { CompletionStore } from '../../src/context/onboarding.js'
import { StaleDraftError } from '../../src/modules/onboarding/service.js'

// ---------------------------------------------------------------------------
// Fake session/snapshot helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<OnboardingSession> = {}): OnboardingSession {
  return {
    id: 'sess-1',
    workspace_id: 'ws-1',
    user_id: 'user-1',
    current_step: 'profile',
    completed_steps: [],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeSnapshot(overrides: Partial<OnboardingSnapshot> = {}): OnboardingSnapshot {
  return {
    session: makeSession(),
    profile: null,
    rules: [],
    obligations: [],
    people: [],
    inviteDrafts: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Fake OnboardingService
// ---------------------------------------------------------------------------

function makeFakeService(overrides: Partial<OnboardingService> = {}): OnboardingService {
  return {
    load: vi.fn().mockResolvedValue(makeSnapshot()),
    saveProfile: vi.fn().mockResolvedValue(makeSnapshot()),
    saveRules: vi.fn().mockResolvedValue(makeSnapshot()),
    saveIndustry: vi.fn().mockResolvedValue(makeSnapshot()),
    savePeople: vi.fn().mockResolvedValue(makeSnapshot()),
    finish: vi.fn().mockResolvedValue({ workspaceId: 'ws-1', completedAt: '2024-01-01T00:00:00Z', invitesSent: 0, invitesFailed: 0 } as FinishResult),
    retryInvitation: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// App builder using injected fakes (avoids live DB)
// ---------------------------------------------------------------------------

async function buildApp(service: OnboardingService, opts: {
  userRole?: string
  bootstrapWorkspaces?: unknown[]
} = {}) {
  const { userRole = 'owner', bootstrapWorkspaces = [] } = opts

  const app = express()
  app.use(express.json())

  // Fake requireAuth — sets req.user + req.accessToken
  const fakeAuth = {
    getUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.com' }),
  }

  // Fake requireWorkspace deps — sets req.workspaceId + req.member
  const fakeMembership = {
    getMembership: vi.fn().mockResolvedValue({ role: userRole, permissions: {} }),
  }

  // Fake store for workspace creation (POST /workspace)
  const fakeOnboardingStore: OnboardingStore = {
    createSession: vi.fn().mockResolvedValue(makeSession()),
    getSession: vi.fn().mockResolvedValue(makeSession()),
    updateProgress: vi.fn().mockResolvedValue(makeSession()),
    listInviteDrafts: vi.fn().mockResolvedValue([]),
    reconcileInviteDrafts: vi.fn().mockResolvedValue([]),
    markInviteDelivery: vi.fn().mockResolvedValue(undefined),
  }

  // Fake supabase for bootstrap route
  const fakeSupabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'u@test.com' } }, error: null }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      rpc: vi.fn().mockReturnThis(),
      then: vi.fn(),
    }),
    rpc: vi.fn().mockResolvedValue({ data: bootstrapWorkspaces, error: null }),
  }

  // Import routes and register
  const { createOnboardingRouter, bootstrapRouter } = await import('../../src/modules/onboarding/routes.js')

  // Bootstrap route (top-level, requireAuth only)
  const bRouter = bootstrapRouter({
    auth: fakeAuth,
    getUserWorkspaces: async (_accessToken: string) => bootstrapWorkspaces as {
      id: string; name: string; role: string; onboardingStatus: 'not_started' | 'in_progress' | 'completed'
    }[],
  })
  app.use(bRouter)

  // Module routes (under /api/m/onboarding)
  const mRouter = createOnboardingRouter({
    makeService: () => service,
    auth: fakeAuth,
    workspace: fakeMembership,
    makeOnboardingStore: (_token: string) => fakeOnboardingStore,
    createWorkspace: async (_accessToken: string, _name: string) => ({ workspaceId: 'new-ws-1' }),
  })
  app.use('/api/m/onboarding', mRouter)

  return app
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/onboarding/bootstrap', () => {
  it('returns 200 with workspaces array', async () => {
    const service = makeFakeService()
    const app = await buildApp(service, { bootstrapWorkspaces: [] })
    const res = await request(app)
      .get('/api/onboarding/bootstrap')
      .set('authorization', 'Bearer tok')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ workspaces: expect.any(Array) })
  })

  it('returns 401 without auth', async () => {
    const service = makeFakeService()
    const app = await buildApp(service)
    const res = await request(app).get('/api/onboarding/bootstrap')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/m/onboarding/workspace', () => {
  it('returns 201 with just auth (no workspace membership required)', async () => {
    const service = makeFakeService()
    // Use a "staff" user — workspace creation is gate-exempt and auth-only
    const app = await buildApp(service, { userRole: 'staff' })
    const res = await request(app)
      .post('/api/m/onboarding/workspace')
      .set('authorization', 'Bearer tok')
      .send({ name: 'Acme Corp' })
    expect(res.status).toBe(201)
  })

  it('returns 400 when name is missing', async () => {
    const service = makeFakeService()
    const app = await buildApp(service)
    const res = await request(app)
      .post('/api/m/onboarding/workspace')
      .set('authorization', 'Bearer tok')
      .send({})
    expect(res.status).toBe(400)
  })
})

describe('PUT /api/m/onboarding/profile', () => {
  const validProfile = { name: 'Acme', jurisdiction: 'AU', size: 'small', description: 'Test co' }

  it('returns 403 for staff member (requireWorkspaceAdmin gate)', async () => {
    const service = makeFakeService()
    const app = await buildApp(service, { userRole: 'staff' })
    const res = await request(app)
      .put('/api/m/onboarding/profile')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .send(validProfile)
    expect(res.status).toBe(403)
  })

  it('returns 200 for owner member', async () => {
    const service = makeFakeService()
    const app = await buildApp(service, { userRole: 'owner' })
    const res = await request(app)
      .put('/api/m/onboarding/profile')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .send(validProfile)
    expect(res.status).toBe(200)
  })

  it('returns 200 for admin member', async () => {
    const service = makeFakeService()
    const app = await buildApp(service, { userRole: 'admin' })
    const res = await request(app)
      .put('/api/m/onboarding/profile')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .send(validProfile)
    expect(res.status).toBe(200)
  })

  it('returns 409 on StaleDraftError', async () => {
    const service = makeFakeService({
      saveProfile: vi.fn().mockRejectedValue(new StaleDraftError('profile', 'p-1')),
    })
    const app = await buildApp(service, { userRole: 'owner' })
    const res = await request(app)
      .put('/api/m/onboarding/profile')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .send(validProfile)
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ error: 'draft changed; reload and retry' })
  })

  it('returns 400 on validation error', async () => {
    const validationErr = Object.assign(new Error('Validation failed'), { errors: { name: 'required' } })
    const service = makeFakeService({
      saveProfile: vi.fn().mockRejectedValue(validationErr),
    })
    const app = await buildApp(service, { userRole: 'owner' })
    const res = await request(app)
      .put('/api/m/onboarding/profile')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .send(validProfile)
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ errors: { name: 'required' } })
  })
})

describe('GET /api/m/onboarding/session', () => {
  it('returns 403 for staff member', async () => {
    const service = makeFakeService()
    const app = await buildApp(service, { userRole: 'staff' })
    const res = await request(app)
      .get('/api/m/onboarding/session')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
    expect(res.status).toBe(403)
  })

  it('returns 200 for owner', async () => {
    const service = makeFakeService()
    const app = await buildApp(service, { userRole: 'owner' })
    const res = await request(app)
      .get('/api/m/onboarding/session')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
    expect(res.status).toBe(200)
  })
})

describe('POST /api/m/onboarding/finish', () => {
  it('returns 200 for owner and returns finish result', async () => {
    const service = makeFakeService()
    const app = await buildApp(service, { userRole: 'owner' })
    const res = await request(app)
      .post('/api/m/onboarding/finish')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .send({})
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ workspaceId: 'ws-1' })
  })
})

describe('POST /api/m/onboarding/retry/:id', () => {
  it('returns 403 for staff member (requireWorkspaceAdmin gate)', async () => {
    const service = makeFakeService()
    const app = await buildApp(service, { userRole: 'staff' })
    const res = await request(app)
      .post('/api/m/onboarding/retry/invite-123')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
    expect(res.status).toBe(403)
  })
})
