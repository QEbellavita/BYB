import { describe, it, expect, vi } from 'vitest'
import type { ImprovementRow, ImprovementStore } from '../../src/modules/improvements/types.js'
import { StaleDraftError } from '../../src/errors.js'
import { createImprovementService } from '../../src/modules/improvements/service.js'

// ---------------------------------------------------------------------------
// Fake helpers
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

function makeFakeStore(rows: ImprovementRow[] = []): ImprovementStore {
  const store: ImprovementRow[] = [...rows]
  return {
    async list(workspaceId, status) {
      return store.filter(r =>
        r.workspace_id === workspaceId &&
        (status === undefined || r.status === status)
      )
    },
    async create(row) {
      const newRow: ImprovementRow = {
        ...row,
        id: 'imp-new',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      store.push(newRow)
      return newRow
    },
    async update(id, patch) {
      const idx = store.findIndex(r => r.id === id)
      if (idx === -1) throw new Error(`Improvement ${id} not found`)
      store[idx] = { ...store[idx], ...patch }
      return store[idx]
    },
    async getById(id) {
      return store.find(r => r.id === id) ?? null
    },
    async upsertAuto() {},
    async clearAuto() {},
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createImprovementService', () => {
  const ctx = { workspaceId: 'ws-1', userId: 'user-1' }

  it('create: inserts with source=manual and status=open', async () => {
    const store = makeFakeStore()
    const svc = createImprovementService({ store })
    const row = await svc.create(ctx, { title: 'Improve onboarding' })
    expect(row.source).toBe('manual')
    expect(row.status).toBe('open')
    expect(row.workspace_id).toBe('ws-1')
  })

  it('create: throws validation error when title is missing', async () => {
    const store = makeFakeStore()
    const updateSpy = vi.spyOn(store, 'create')
    const svc = createImprovementService({ store })
    const err = await svc.create(ctx, { title: '' }).catch(e => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('Validation failed')
    expect(err.errors).toMatchObject({ title: 'Title is required' })
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('update: throws validation error when version is missing (no write)', async () => {
    const existingRow = makeRow({ id: 'imp-1', version: 2 })
    const store = makeFakeStore([existingRow])
    const updateSpy = vi.spyOn(store, 'update')
    const svc = createImprovementService({ store })
    const err = await svc.update(ctx, 'imp-1', { title: 'Updated' }).catch(e => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('Validation failed')
    expect(err.errors).toMatchObject({ version: 'Required for update' })
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('update: throws StaleDraftError on version mismatch (no write)', async () => {
    const existingRow = makeRow({ id: 'imp-1', version: 2 })
    const store = makeFakeStore([existingRow])
    const updateSpy = vi.spyOn(store, 'update')
    const svc = createImprovementService({ store })
    await expect(svc.update(ctx, 'imp-1', { title: 'Updated', version: 1 })).rejects.toThrow(StaleDraftError)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('update: succeeds with correct version', async () => {
    const existingRow = makeRow({ id: 'imp-1', version: 1 })
    const store = makeFakeStore([existingRow])
    const svc = createImprovementService({ store })
    const row = await svc.update(ctx, 'imp-1', { title: 'Updated title', version: 1 })
    expect(row).toBeDefined()
    expect(row.title).toBe('Updated title')
  })

  it('update: does NOT change status even when status supplied in body', async () => {
    const existingRow = makeRow({ id: 'imp-1', version: 1, status: 'open' })
    const store = makeFakeStore([existingRow])
    const updateSpy = vi.spyOn(store, 'update')
    const svc = createImprovementService({ store })
    const row = await svc.update(ctx, 'imp-1', { title: 'Updated', version: 1, status: 'done' })
    expect(row.status).toBe('open')
    expect(updateSpy).toHaveBeenCalledWith('imp-1', expect.objectContaining({ status: 'open' }))
  })

  it('setStatus: transitions to actioned', async () => {
    const existingRow = makeRow({ id: 'imp-1', version: 1, status: 'open' })
    const store = makeFakeStore([existingRow])
    const svc = createImprovementService({ store })
    const row = await svc.setStatus(ctx, 'imp-1', 'actioned')
    expect(row.status).toBe('actioned')
  })

  it('setStatus: transitions to dismissed', async () => {
    const existingRow = makeRow({ id: 'imp-1', version: 1, status: 'open' })
    const store = makeFakeStore([existingRow])
    const svc = createImprovementService({ store })
    const row = await svc.setStatus(ctx, 'imp-1', 'dismissed')
    expect(row.status).toBe('dismissed')
  })

  it('setStatus: transitions to done', async () => {
    const existingRow = makeRow({ id: 'imp-1', version: 1, status: 'open' })
    const store = makeFakeStore([existingRow])
    const svc = createImprovementService({ store })
    const row = await svc.setStatus(ctx, 'imp-1', 'done')
    expect(row.status).toBe('done')
  })

  it('setStatus: rejects invalid status', async () => {
    const existingRow = makeRow({ id: 'imp-1', version: 1, status: 'open' })
    const store = makeFakeStore([existingRow])
    const updateSpy = vi.spyOn(store, 'update')
    const svc = createImprovementService({ store })
    const err = await svc.setStatus(ctx, 'imp-1', 'invalid').catch(e => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('Validation failed')
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('list: returns only improvements for the requesting workspace', async () => {
    const rows = [
      makeRow({ id: 'i-a', workspace_id: 'ws-1' }),
      makeRow({ id: 'i-b', workspace_id: 'ws-2' }),
    ]
    const store = makeFakeStore(rows)
    const svc = createImprovementService({ store })
    const results = await svc.list({ workspaceId: 'ws-1', userId: 'user-1' })
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('i-a')
  })

  it('list: filters by status when provided', async () => {
    const rows = [
      makeRow({ id: 'i-1', workspace_id: 'ws-1', status: 'open' }),
      makeRow({ id: 'i-2', workspace_id: 'ws-1', status: 'done' }),
    ]
    const store = makeFakeStore(rows)
    const svc = createImprovementService({ store })
    const results = await svc.list(ctx, 'open')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('i-1')
  })
})
