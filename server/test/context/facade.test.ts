import { describe, it, expect } from 'vitest'
import { ContextHub } from '../../src/context/index.js'
import type { HubStore } from '../../src/context/types.js'

function recordingStore() {
  const calls: any[] = []
  const store: HubStore = {
    async insert(t, r) { calls.push(['insert', t, r]); return { id: 'x', ...r } as any },
    async update(t, id, p) { calls.push(['update', t, id, p]); return { id, ...p } as any },
    async getById(t, id) { calls.push(['getById', t, id]); return null },
    async select(t, f) { calls.push(['select', t, f]); return [] },
  }
  return { store, calls }
}

describe('ContextHub facade', () => {
  it('exposes all 8 entity wrappers + links', () => {
    for (const k of ['profile','rules','obligations','processes','decisionLogic','riskFrameworks','governance','people'])
      expect(ContextHub).toHaveProperty(k)
    expect(ContextHub.links).toBeDefined()
  })
  it('each wrapper targets its own table', async () => {
    const map: [any, string][] = [
      [ContextHub.profile, 'business_profile'], [ContextHub.rules, 'business_rules'],
      [ContextHub.obligations, 'compliance_obligations'], [ContextHub.processes, 'internal_processes'],
      [ContextHub.decisionLogic, 'decision_logic'], [ContextHub.riskFrameworks, 'risk_frameworks'],
      [ContextHub.governance, 'governance'], [ContextHub.people, 'org_people'],
    ]
    for (const [wrapper, table] of map) {
      const { store, calls } = recordingStore()
      await wrapper.upsert(store, { workspace_id: 'w1' })
      expect(calls[0]).toEqual(['insert', table, { workspace_id: 'w1' }])
    }
  })
})
