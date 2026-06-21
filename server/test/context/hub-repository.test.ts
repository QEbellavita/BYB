import { describe, it, expect } from 'vitest'
import { hubRepository } from '../../src/context/hub-repository.js'
import type { HubStore, HubRow } from '../../src/context/types.js'

function fakeStore() {
  const calls: any[] = []
  const store: HubStore = {
    async insert(table, row) { calls.push(['insert', table, row]); return { id: 'new', ...row } as HubRow },
    async update(table, id, patch) { calls.push(['update', table, id, patch]); return { id, ...patch } as HubRow },
    async getById(table, id) { calls.push(['getById', table, id]); return { id } as HubRow },
    async select(table, filters) { calls.push(['select', table, filters]); return [] },
  }
  return { store, calls }
}

describe('hubRepository', () => {
  const repo = hubRepository('business_rules')

  it('upsert without id inserts (workspace_id preserved, no server fields)', async () => {
    const { store, calls } = fakeStore()
    await repo.upsert(store, { workspace_id: 'w1', area: 'hr' })
    expect(calls[0]).toEqual(['insert', 'business_rules', { workspace_id: 'w1', area: 'hr' }])
  })
  it('upsert with id updates and strips id from patch', async () => {
    const { store, calls } = fakeStore()
    await repo.upsert(store, { id: 'r1', area: 'finance' })
    expect(calls[0]).toEqual(['update', 'business_rules', 'r1', { area: 'finance' }])
  })
  it('deprecate sets status archived', async () => {
    const { store, calls } = fakeStore()
    await repo.deprecate(store, 'r1')
    expect(calls[0]).toEqual(['update', 'business_rules', 'r1', { status: 'archived' }])
  })
  it('approve sets status active', async () => {
    const { store, calls } = fakeStore()
    await repo.approve(store, 'r1')
    expect(calls[0]).toEqual(['update', 'business_rules', 'r1', { status: 'active' }])
  })
  it('list passes workspace_id and filters', async () => {
    const { store, calls } = fakeStore()
    await repo.list(store, 'w1', { area: 'hr' })
    expect(calls[0]).toEqual(['select', 'business_rules', { workspace_id: 'w1', area: 'hr' }])
  })
})
