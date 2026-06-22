import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import type { RiskRow, RiskService, RiskServiceContext } from '../../src/modules/risk/types.js'
import { StaleDraftError } from '../../src/errors.js'
import { createRiskRouter } from '../../src/modules/risk/routes.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<RiskRow> = {}): RiskRow {
  return {
    id: 'risk-1',
    workspace_id: 'ws-1',
    version: 1,
    title: 'Test Risk',
    description: null,
    category: null,
    likelihood: 3,
    impact: 3,
    owner_person_id: null,
    treatment: null,
    status: 'open',
    review_date: null,
    framework_id: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeFakeService(overrides: Partial<RiskService> = {}): RiskService {
  return {
    list: vi.fn().mockResolvedValue([makeRow()]),
    create: vi.fn().mockResolvedValue(makeRow()),
    update: vi.fn().mockResolvedValue(makeRow()),
    close: vi.fn().mockResolvedValue(makeRow({ status: 'closed' })),
    linkRule: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function buildApp(service: RiskService, userRole = 'owner') {
  const app = express()
  app.use(express.json())

  const fakeAuth = { getUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.com' }) }
  const fakeMembership = { getMembership: vi.fn().mockResolvedValue({ role: userRole, permissions: {} }) }

  const router = createRiskRouter({ service, auth: fakeAuth, workspace: fakeMembership })
  app.use('/api/m/risk', router)
  return app
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/m/risk/risks', () => {
  it('returns 200 with list of risks', async () => {
    const service = makeFakeService()
    const app = buildApp(service)
    const res = await request(app)
      .get('/api/m/risk/risks')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ risks: expect.any(Array) })
  })

  it('returns 401 without auth', async () => {
    const service = makeFakeService()
    const app = buildApp(service)
    const res = await request(app).get('/api/m/risk/risks')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/m/risk/risks', () => {
  const validRisk = { title: 'Fire Risk', likelihood: 3, impact: 4 }

  it('returns 201 on valid risk', async () => {
    const service = makeFakeService()
    const app = buildApp(service)
    const res = await request(app)
      .post('/api/m/risk/risks')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .send(validRisk)
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ id: 'risk-1' })
  })

  it('returns 400 on invalid risk', async () => {
    const service = makeFakeService({
      create: vi.fn().mockRejectedValue(
        Object.assign(new Error('Validation failed'), { errors: { title: 'Title is required' } })
      ),
    })
    const app = buildApp(service)
    const res = await request(app)
      .post('/api/m/risk/risks')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .send({ title: '', likelihood: 1, impact: 1 })
    expect(res.status).toBe(400)
  })
})

describe('PUT /api/m/risk/risks/:id', () => {
  it('returns 409 on StaleDraftError', async () => {
    const service = makeFakeService({
      update: vi.fn().mockRejectedValue(new StaleDraftError('risk_entry', 'risk-1')),
    })
    const app = buildApp(service)
    const res = await request(app)
      .put('/api/m/risk/risks/risk-1')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .send({ title: 'Updated', likelihood: 2, impact: 2, version: 0 })
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ error: 'draft changed; reload and retry' })
  })

  it('returns 200 on successful update', async () => {
    const service = makeFakeService()
    const app = buildApp(service)
    const res = await request(app)
      .put('/api/m/risk/risks/risk-1')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .send({ title: 'Updated Risk', likelihood: 2, impact: 2, version: 1 })
    expect(res.status).toBe(200)
  })
})

describe('POST /api/m/risk/risks/:id/close', () => {
  it('returns 200 and closed status', async () => {
    const service = makeFakeService()
    const app = buildApp(service)
    const res = await request(app)
      .post('/api/m/risk/risks/risk-1/close')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'closed' })
  })
})
