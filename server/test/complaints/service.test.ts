import { describe, it, expect, vi } from 'vitest'
import type { ComplaintRow, ComplaintStore } from '../../src/modules/complaints/types.js'
import type { PublishEvent } from '../../src/events/publish.js'
import type { LinkStore } from '../../src/context/links.js'
import { StaleDraftError } from '../../src/errors.js'
import { createComplaintsService } from '../../src/modules/complaints/service.js'
import { links } from '../../src/context/links.js'

// ---------------------------------------------------------------------------
// Fake helpers
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
    category: null,
    customer_id: null,
    notes: null,
    resolved_at: null,
    received_at: '2024-01-01T00:00:00Z',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeFakeStore(rows: ComplaintRow[] = []): ComplaintStore {
  const store: ComplaintRow[] = [...rows]
  return {
    async list(workspaceId) {
      return store.filter(r => r.workspace_id === workspaceId)
    },
    async create(row) {
      const newRow: ComplaintRow = {
        ...row,
        id: 'complaint-new',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      store.push(newRow)
      return newRow
    },
    async update(id, patch) {
      const idx = store.findIndex(r => r.id === id)
      if (idx === -1) throw new Error(`Complaint ${id} not found`)
      store[idx] = { ...store[idx], ...patch }
      return store[idx]
    },
    async getById(id) {
      return store.find(r => r.id === id) ?? null
    },
    async countForWorkspace(workspaceId) {
      return store.filter(r => r.workspace_id === workspaceId).length
    },
    async countByCategorySince(workspaceId, category, sinceIso) {
      return store.filter(r =>
        r.workspace_id === workspaceId &&
        r.category === category &&
        r.received_at >= sinceIso
      ).length
    },
  }
}

function makeFakeLinkStore(): LinkStore {
  return {
    async insertLink(row) {
      return {
        id: 'link-1',
        workspace_id: row['workspace_id'] as string,
        from_type: row['from_type'] as string,
        from_id: row['from_id'] as string,
        to_type: row['to_type'] as string,
        to_id: row['to_id'] as string,
        relation: row['relation'] as string | null,
        created_at: new Date().toISOString(),
      }
    },
    async selectLinks() { return [] },
    async deleteLink() {},
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createComplaintsService', () => {
  const ctx = { workspaceId: 'ws-1', userId: 'user-1' }

  it('create: assigns reference starting with C-, inserts status new, publishes complaint.created', async () => {
    const store = makeFakeStore()
    const published: PublishEvent[] = []
    const publish = vi.fn(async (e: PublishEvent) => { published.push(e) })
    const linkStore = makeFakeLinkStore()

    const svc = createComplaintsService({ store, publish, links, linkStore })
    const row = await svc.create(ctx, { description: 'Customer angry' })

    expect(row.reference).toMatch(/^C-/)
    expect(row.status).toBe('new')
    expect(row.workspace_id).toBe('ws-1')
    expect(published).toHaveLength(1)
    expect(published[0]).toMatchObject({
      type: 'complaint.created',
      entity_type: 'complaint',
      workspace_id: 'ws-1',
      after: row,
    })
    expect(published[0].entity_id).toBe(row.id)
  })

  it('create: reference is padded to 3 digits (C-001 for first complaint)', async () => {
    const store = makeFakeStore()
    const publish = vi.fn(async () => {})
    const linkStore = makeFakeLinkStore()

    const svc = createComplaintsService({ store, publish, links, linkStore })
    const row = await svc.create(ctx, { description: 'First complaint' })
    expect(row.reference).toBe('C-001')
  })

  it('update: throws validation error when version is missing (no write)', async () => {
    const existingRow = makeRow({ id: 'complaint-1', version: 2 })
    const store = makeFakeStore([existingRow])
    const publish = vi.fn(async () => {})
    const linkStore = makeFakeLinkStore()
    const updateSpy = vi.spyOn(store, 'update')

    const svc = createComplaintsService({ store, publish, links, linkStore })

    const err = await svc.update(ctx, 'complaint-1', { description: 'Updated' }).catch(e => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('Validation failed')
    expect(err.errors).toMatchObject({ version: 'Required for update' })
    expect(updateSpy).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('update: throws StaleDraftError on version mismatch (no write)', async () => {
    const existingRow = makeRow({ id: 'complaint-1', version: 2 })
    const store = makeFakeStore([existingRow])
    const published: PublishEvent[] = []
    const publish = vi.fn(async (e: PublishEvent) => { published.push(e) })
    const linkStore = makeFakeLinkStore()
    const updateSpy = vi.spyOn(store, 'update')

    const svc = createComplaintsService({ store, publish, links, linkStore })

    await expect(svc.update(ctx, 'complaint-1', { description: 'Updated', version: 1 }))
      .rejects.toThrow(StaleDraftError)

    expect(updateSpy).not.toHaveBeenCalled()
    expect(published).toHaveLength(0)
  })

  it('update: succeeds and publishes complaint.updated', async () => {
    const existingRow = makeRow({ id: 'complaint-1', version: 1 })
    const store = makeFakeStore([existingRow])
    const published: PublishEvent[] = []
    const publish = vi.fn(async (e: PublishEvent) => { published.push(e) })
    const linkStore = makeFakeLinkStore()

    const svc = createComplaintsService({ store, publish, links, linkStore })
    const row = await svc.update(ctx, 'complaint-1', { description: 'Updated desc', version: 1 })

    expect(row).toBeDefined()
    expect(published).toHaveLength(1)
    expect(published[0].type).toBe('complaint.updated')
  })

  it('update: does NOT change status even when status is supplied in the body', async () => {
    const existingRow = makeRow({ id: 'complaint-1', version: 1, status: 'new' })
    const store = makeFakeStore([existingRow])
    const publish = vi.fn(async () => {})
    const linkStore = makeFakeLinkStore()
    const updateSpy = vi.spyOn(store, 'update')

    const svc = createComplaintsService({ store, publish, links, linkStore })
    const row = await svc.update(ctx, 'complaint-1', { description: 'Updated desc', version: 1, status: 'closed' })

    // Status must remain 'new' — status is managed by dedicated transitions only
    expect(row.status).toBe('new')
    // Confirm store.update was called with status: 'new', NOT 'closed'
    expect(updateSpy).toHaveBeenCalledWith('complaint-1', expect.objectContaining({ status: 'new' }))
  })

  it('resolve: sets status to resolved + resolved_at and publishes complaint.resolved', async () => {
    const existingRow = makeRow({ id: 'complaint-1', version: 1, status: 'new' })
    const store = makeFakeStore([existingRow])
    const published: PublishEvent[] = []
    const publish = vi.fn(async (e: PublishEvent) => { published.push(e) })
    const linkStore = makeFakeLinkStore()

    const svc = createComplaintsService({ store, publish, links, linkStore })
    const row = await svc.resolve(ctx, 'complaint-1')

    expect(row.status).toBe('resolved')
    expect(row.resolved_at).not.toBeNull()
    expect(published).toHaveLength(1)
    expect(published[0].type).toBe('complaint.resolved')
  })

  it('resolve: rejects resolving a closed complaint', async () => {
    const existingRow = makeRow({ id: 'complaint-1', version: 1, status: 'closed' })
    const store = makeFakeStore([existingRow])
    const publish = vi.fn(async () => {})
    const linkStore = makeFakeLinkStore()
    const updateSpy = vi.spyOn(store, 'update')

    const svc = createComplaintsService({ store, publish, links, linkStore })

    await expect(svc.resolve(ctx, 'complaint-1')).rejects.toThrow('Cannot resolve')
    expect(updateSpy).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('resolve: rejects resolving an already-resolved complaint (no write, no publish)', async () => {
    const existingRow = makeRow({ id: 'complaint-1', version: 2, status: 'resolved', resolved_at: '2024-01-01T00:00:00Z' })
    const store = makeFakeStore([existingRow])
    const publish = vi.fn(async () => {})
    const linkStore = makeFakeLinkStore()
    const updateSpy = vi.spyOn(store, 'update')

    const svc = createComplaintsService({ store, publish, links, linkStore })

    await expect(svc.resolve(ctx, 'complaint-1')).rejects.toThrow('Cannot resolve')
    expect(updateSpy).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('list: returns only complaints for the requesting workspace', async () => {
    const wsARow = makeRow({ id: 'c-a', workspace_id: 'ws-1' })
    const wsBRow = makeRow({ id: 'c-b', workspace_id: 'ws-2' })
    const store = makeFakeStore([wsARow, wsBRow])
    const publish = vi.fn(async () => {})
    const linkStore = makeFakeLinkStore()

    const svc = createComplaintsService({ store, publish, links, linkStore })
    const results = await svc.list({ workspaceId: 'ws-1', userId: 'user-1' })

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('c-a')
  })

  it('linkRule: calls links.connect from complaint to business_rule with relation concerns', async () => {
    const existingRow = makeRow({ id: 'complaint-1', version: 1 })
    const store = makeFakeStore([existingRow])
    const publish = vi.fn(async () => {})
    const linkStore = makeFakeLinkStore()
    const connectSpy = vi.spyOn(linkStore, 'insertLink')

    const svc = createComplaintsService({ store, publish, links, linkStore })
    await svc.linkRule(ctx, 'complaint-1', 'rule-1')

    expect(connectSpy).toHaveBeenCalledWith(expect.objectContaining({
      workspace_id: 'ws-1',
      from_type: 'complaint',
      from_id: 'complaint-1',
      to_type: 'business_rule',
      to_id: 'rule-1',
      relation: 'concerns',
    }))
  })

  it('linkProcess: calls links.connect from complaint to internal_process with relation concerns', async () => {
    const existingRow = makeRow({ id: 'complaint-1', version: 1 })
    const store = makeFakeStore([existingRow])
    const publish = vi.fn(async () => {})
    const linkStore = makeFakeLinkStore()
    const connectSpy = vi.spyOn(linkStore, 'insertLink')

    const svc = createComplaintsService({ store, publish, links, linkStore })
    await svc.linkProcess(ctx, 'complaint-1', 'proc-1')

    expect(connectSpy).toHaveBeenCalledWith(expect.objectContaining({
      workspace_id: 'ws-1',
      from_type: 'complaint',
      from_id: 'complaint-1',
      to_type: 'internal_process',
      to_id: 'proc-1',
      relation: 'concerns',
    }))
  })

  it('create: persists category when provided', async () => {
    const store = makeFakeStore()
    const publish = vi.fn(async () => {})
    const linkStore = makeFakeLinkStore()

    const svc = createComplaintsService({ store, publish, links, linkStore })
    const row = await svc.create(ctx, { description: 'Billing issue', category: 'billing' })

    expect(row.category).toBe('billing')
  })

  it('create: stores null for category when not provided', async () => {
    const store = makeFakeStore()
    const publish = vi.fn(async () => {})
    const linkStore = makeFakeLinkStore()

    const svc = createComplaintsService({ store, publish, links, linkStore })
    const row = await svc.create(ctx, { description: 'General complaint' })

    expect(row.category).toBeNull()
  })

  it('create: stores null for category when empty string provided', async () => {
    const store = makeFakeStore()
    const publish = vi.fn(async () => {})
    const linkStore = makeFakeLinkStore()

    const svc = createComplaintsService({ store, publish, links, linkStore })
    const row = await svc.create(ctx, { description: 'Whitespace category', category: '   ' })

    expect(row.category).toBeNull()
  })
})
