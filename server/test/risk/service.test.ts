import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RiskRow, RiskStore } from '../../src/modules/risk/types.js'
import type { PublishEvent } from '../../src/events/publish.js'
import type { LinkStore } from '../../src/context/links.js'
import { StaleDraftError } from '../../src/errors.js'
import { createRiskService } from '../../src/modules/risk/service.js'
import { links } from '../../src/context/links.js'

// ---------------------------------------------------------------------------
// Fake helpers
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
    severity: 'med',
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

function makeFakeStore(rows: RiskRow[] = []): RiskStore {
  const store: RiskRow[] = [...rows]
  return {
    async list(workspaceId) {
      return store.filter(r => r.workspace_id === workspaceId)
    },
    async create(row) {
      const newRow = { ...row, id: 'risk-new', version: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as RiskRow
      store.push(newRow)
      return newRow
    },
    async update(id, patch) {
      const idx = store.findIndex(r => r.id === id)
      if (idx === -1) throw new Error(`Risk ${id} not found`)
      store[idx] = { ...store[idx], ...patch }
      return store[idx]
    },
    async getById(id) {
      return store.find(r => r.id === id) ?? null
    },
  }
}

function makeFakeLinkStore(): LinkStore {
  return {
    async insertLink(row) {
      return { id: 'link-1', workspace_id: row['workspace_id'] as string, from_type: row['from_type'] as string, from_id: row['from_id'] as string, to_type: row['to_type'] as string, to_id: row['to_id'] as string, relation: row['relation'] as string | null, created_at: new Date().toISOString() }
    },
    async selectLinks() { return [] },
    async deleteLink() {},
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createRiskService', () => {
  const ctx = { workspaceId: 'ws-1', userId: 'user-1' }

  it('create: calls store.create with status open and publishes risk.created', async () => {
    const store = makeFakeStore()
    const published: PublishEvent[] = []
    const publish = vi.fn(async (e: PublishEvent) => { published.push(e) })
    const linkStore = makeFakeLinkStore()

    const svc = createRiskService({ store, publish, links, linkStore })
    const row = await svc.create(ctx, { title: 'Fire Risk', likelihood: 3, impact: 4 })

    expect(row.status).toBe('open')
    expect(row.workspace_id).toBe('ws-1')
    expect(published).toHaveLength(1)
    expect(published[0]).toMatchObject({
      type: 'risk.created',
      entity_type: 'risk_entry',
      workspace_id: 'ws-1',
    })
    expect(published[0].entity_id).toBe(row.id)
  })

  it('update: throws StaleDraftError when version mismatches (no write)', async () => {
    const existingRow = makeRow({ id: 'risk-1', version: 2 })
    const store = makeFakeStore([existingRow])
    const published: PublishEvent[] = []
    const publish = vi.fn(async (e: PublishEvent) => { published.push(e) })
    const linkStore = makeFakeLinkStore()
    const updateSpy = vi.spyOn(store, 'update')

    const svc = createRiskService({ store, publish, links, linkStore })

    await expect(svc.update(ctx, 'risk-1', { title: 'Updated', likelihood: 2, impact: 2, version: 1 }))
      .rejects.toThrow(StaleDraftError)

    expect(updateSpy).not.toHaveBeenCalled()
    expect(published).toHaveLength(0)
  })

  it('close: sets status to closed and publishes', async () => {
    const existingRow = makeRow({ id: 'risk-1', version: 1 })
    const store = makeFakeStore([existingRow])
    const published: PublishEvent[] = []
    const publish = vi.fn(async (e: PublishEvent) => { published.push(e) })
    const linkStore = makeFakeLinkStore()

    const svc = createRiskService({ store, publish, links, linkStore })
    const row = await svc.close(ctx, 'risk-1')

    expect(row.status).toBe('closed')
    expect(published).toHaveLength(1)
    expect(published[0].type).toBe('risk.closed')
  })

  it('update: rejects with validation error when version is absent (no write)', async () => {
    const existingRow = makeRow({ id: 'risk-1', version: 2 })
    const store = makeFakeStore([existingRow])
    const publish = vi.fn(async () => {})
    const linkStore = makeFakeLinkStore()
    const updateSpy = vi.spyOn(store, 'update')

    const svc = createRiskService({ store, publish, links, linkStore })

    // Omit version entirely
    const err = await svc.update(ctx, 'risk-1', { title: 'Updated', likelihood: 2, impact: 2 }).catch(e => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('Validation failed')
    expect(err.errors).toMatchObject({ version: 'Required for update' })
    expect(updateSpy).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('list: returns only risks for the requesting workspace', async () => {
    const wsARow = makeRow({ id: 'risk-a', workspace_id: 'ws-1' })
    const wsBRow = makeRow({ id: 'risk-b', workspace_id: 'ws-2' })
    const store = makeFakeStore([wsARow, wsBRow])
    const publish = vi.fn(async () => {})
    const linkStore = makeFakeLinkStore()
    const listSpy = vi.spyOn(store, 'list')

    const svc = createRiskService({ store, publish, links, linkStore })
    const results = await svc.list({ workspaceId: 'ws-1', userId: 'user-1' })

    expect(listSpy).toHaveBeenCalledWith('ws-1')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('risk-a')
    expect(results.find(r => r.workspace_id === 'ws-2')).toBeUndefined()
  })

  it('linkRule: calls links.connect from risk_entry to business_rule with relation addresses', async () => {
    const existingRow = makeRow({ id: 'risk-1', version: 1 })
    const store = makeFakeStore([existingRow])
    const publish = vi.fn(async () => {})
    const linkStore = makeFakeLinkStore()
    const connectSpy = vi.spyOn(linkStore, 'insertLink')

    const svc = createRiskService({ store, publish, links, linkStore })
    await svc.linkRule(ctx, 'risk-1', 'rule-1')

    expect(connectSpy).toHaveBeenCalledWith(expect.objectContaining({
      workspace_id: 'ws-1',
      from_type: 'risk_entry',
      from_id: 'risk-1',
      to_type: 'business_rule',
      to_id: 'rule-1',
      relation: 'addresses',
    }))
  })
})
