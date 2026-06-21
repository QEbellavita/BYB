import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import type { ImprovementRow, ImprovementService, ImprovementServiceContext } from '../../src/modules/improvements/types.js'
import { StaleDraftError } from '../../src/errors.js'
import { createImprovementsRouter } from '../../src/modules/improvements/routes.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<ImprovementRow> = {}): ImprovementRow {
  return {
    id: 'imp-1',
    workspace_id: 'ws-1',
    version: 1,
    title: 'Improve the process',
    suggested_change: null,
    source: 'manual',
    status: 'open',
    trigger_kind: null,
    dedup_key: null,
    source_ref: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeFakeService(overrides: Partial<ImprovementService> = {}): ImprovementService {
  return {
    list: vi.fn().mockResolvedValue([makeRow()]),
    create: vi.fn().mockResolvedValue(makeRow()),
    update: vi.fn().mockResolvedValue(makeRow()),
    setStatus: vi.fn().mockResolvedValue(makeRow({ status: 'actioned' })),
    ...overrides,
  }
}

function buildApp(service: ImprovementService, userRole = 'owner') {
  const app = express()
  app.use(express.json())

  const fakeAuth = { getUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.com' }) }
  const fakeMembership = { getMembership: vi.fn().mockResolvedValue({ role: userRole, permissions: {} }) }

  const router = createImprovementsRouter({ service, auth: fakeAuth, workspace: fakeMembership })
  app.use('/api/m/improvements', router)
  return app
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/m/improvements/improvements', () => {
  it('returns 200 with list of improvements', async () => {
    const service = makeFakeService()
    const app = buildApp(service)
    const res = await request(app)
      .get('/api/m/improvements/improvements')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ improvements: expect.any(Array) })
  })

  it('returns 401 without auth', async () => {
    const service = makeFakeService()
    const app = buildApp(service)
    const res = await request(app).get('/api/m/improvements/improvements')
    expect(res.status).toBe(401)
  })

  it('passes status filter to service when provided', async () => {
    const service = makeFakeService()
    const app = buildApp(service)
    await request(app)
      .get('/api/m/improvements/improvements?status=open')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
    expect(service.list).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1' }),
      'open',
    )
  })
})

describe('POST /api/m/improvements/improvements', () => {
  it('returns 201 on valid improvement', async () => {
    const service = makeFakeService()
    const app = buildApp(service)
    const res = await request(app)
      .post('/api/m/improvements/improvements')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .send({ title: 'Improve the risk process' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ id: 'imp-1' })
  })

  it('returns 400 on validation error', async () => {
    const service = makeFakeService({
      create: vi.fn().mockRejectedValue(
        Object.assign(new Error('Validation failed'), { errors: { title: 'Title is required' } })
      ),
    })
    const app = buildApp(service)
    const res = await request(app)
      .post('/api/m/improvements/improvements')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .send({})
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ errors: { title: 'Title is required' } })
  })
})

describe('PUT /api/m/improvements/improvements/:id', () => {
  it('returns 409 on StaleDraftError', async () => {
    const service = makeFakeService({
      update: vi.fn().mockRejectedValue(new StaleDraftError('improvement', 'imp-1')),
    })
    const app = buildApp(service)
    const res = await request(app)
      .put('/api/m/improvements/improvements/imp-1')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .send({ title: 'Updated', version: 0 })
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ error: 'draft changed; reload and retry' })
  })

  it('returns 200 on successful update', async () => {
    const service = makeFakeService()
    const app = buildApp(service)
    const res = await request(app)
      .put('/api/m/improvements/improvements/imp-1')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .send({ title: 'Updated improvement', version: 1 })
    expect(res.status).toBe(200)
  })

  it('returns 400 on validation error', async () => {
    const service = makeFakeService({
      update: vi.fn().mockRejectedValue(
        Object.assign(new Error('Validation failed'), { errors: { version: 'Required for update' } })
      ),
    })
    const app = buildApp(service)
    const res = await request(app)
      .put('/api/m/improvements/improvements/imp-1')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .send({ title: 'Updated' })
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ errors: { version: 'Required for update' } })
  })
})

describe('POST /api/m/improvements/improvements/:id/status', () => {
  it('returns 200 and updated status on setStatus', async () => {
    const service = makeFakeService()
    const app = buildApp(service)
    const res = await request(app)
      .post('/api/m/improvements/improvements/imp-1/status')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .send({ status: 'actioned' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'actioned' })
  })

  it('returns 400 when status body is missing', async () => {
    const service = makeFakeService()
    const app = buildApp(service)
    const res = await request(app)
      .post('/api/m/improvements/improvements/imp-1/status')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .send({})
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ errors: { status: 'Required' } })
  })

  it('returns 400 on invalid status value', async () => {
    const service = makeFakeService({
      setStatus: vi.fn().mockRejectedValue(
        Object.assign(new Error('Validation failed'), { errors: { status: 'Must be one of: open, actioned, dismissed, done' } })
      ),
    })
    const app = buildApp(service)
    const res = await request(app)
      .post('/api/m/improvements/improvements/imp-1/status')
      .set('authorization', 'Bearer tok')
      .set('x-workspace-id', 'ws-1')
      .send({ status: 'invalid_status' })
    expect(res.status).toBe(400)
  })
})
