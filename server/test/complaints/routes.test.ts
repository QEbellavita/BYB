import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import type { ComplaintRow, ComplaintService, ComplaintServiceContext } from '../../src/modules/complaints/types.js'
import { StaleDraftError } from '../../src/errors.js'
import { createComplaintsRouter } from '../../src/modules/complaints/routes.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<ComplaintRow> = {}): ComplaintRow {
  return {
    id: 'complaint-1',
    workspace_id: 'ws-1',
    reference: 'C-001',
    version: 1,
    description: 'Customer complaint',
    channel: null,
    severity: 'low',
    status: 'new',
    customer_id: null,
    notes: null,
    resolved_at: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeFakeService(overrides: Partial<ComplaintService> = {}): ComplaintService {
  return {
    list: vi.fn().mockResolvedValue([makeRow()]),
    create: vi.fn().mockResolvedValue(makeRow()),
    update: vi.fn().mockResolvedValue(makeRow()),
    resolve: vi.fn().mockResolvedValue(makeRow({ status: 'resolved', resolved_at: new Date().toISOString() })),
    linkRule: vi.fn().mockResolvedValue(undefined),
    linkProcess: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function buildApp(service: ComplaintService, userRole = 'owner') {
  const app = express()
  app.use(express.json())

  const fakeAuth = { getUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.com' }) }
  const fakeMembership = { getMembership: vi.fn().mockResolvedValue({ role: userRole, permissions: {} }) }

  const router = createComplaintsRouter({ service, auth: fakeAuth, workspace: fakeMembership })
  app.use('/api/m/complaints', router)
  return app
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/m/complaints/complaints', () => {
  it('returns 200 with list of complaints', async () => {
    const service = makeFakeService()
    const app = buildApp(service)
    const res = await request(app)
      .get('/api/m/complaints/complaints')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ complaints: expect.any(Array) })
  })

  it('returns 401 without auth', async () => {
    const service = makeFakeService()
    const app = buildApp(service)
    const res = await request(app).get('/api/m/complaints/complaints')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/m/complaints/complaints', () => {
  it('returns 201 on valid complaint', async () => {
    const service = makeFakeService()
    const app = buildApp(service)
    const res = await request(app)
      .post('/api/m/complaints/complaints')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .send({ description: 'Customer very unhappy' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ id: 'complaint-1' })
  })

  it('returns 400 on validation error', async () => {
    const service = makeFakeService({
      create: vi.fn().mockRejectedValue(
        Object.assign(new Error('Validation failed'), { errors: { description: 'Required' } })
      ),
    })
    const app = buildApp(service)
    const res = await request(app)
      .post('/api/m/complaints/complaints')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .send({})
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ errors: { description: 'Required' } })
  })
})

describe('PUT /api/m/complaints/complaints/:id', () => {
  it('returns 409 on StaleDraftError', async () => {
    const service = makeFakeService({
      update: vi.fn().mockRejectedValue(new StaleDraftError('complaint', 'complaint-1')),
    })
    const app = buildApp(service)
    const res = await request(app)
      .put('/api/m/complaints/complaints/complaint-1')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .send({ description: 'Updated', version: 0 })
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ error: 'draft changed; reload and retry' })
  })

  it('returns 200 on successful update', async () => {
    const service = makeFakeService()
    const app = buildApp(service)
    const res = await request(app)
      .put('/api/m/complaints/complaints/complaint-1')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .send({ description: 'Updated complaint', version: 1 })
    expect(res.status).toBe(200)
  })
})

describe('POST /api/m/complaints/complaints/:id/resolve', () => {
  it('returns 200 and resolved status', async () => {
    const service = makeFakeService()
    const app = buildApp(service)
    const res = await request(app)
      .post('/api/m/complaints/complaints/complaint-1/resolve')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'resolved' })
  })

  it('returns 400 when resolving already closed complaint', async () => {
    const service = makeFakeService({
      resolve: vi.fn().mockRejectedValue(new Error('Cannot resolve a closed complaint')),
    })
    const app = buildApp(service)
    const res = await request(app)
      .post('/api/m/complaints/complaints/complaint-1/resolve')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
    expect(res.status).toBe(400)
  })
})
