import { describe, it, expect, vi } from 'vitest'
import { createRegistry, dispatchPendingEvents, type ContextEvent, type EventStore } from '../../src/context/events.js'

function ev(id: string, type: string): ContextEvent {
  return { id, workspace_id: 'w', type, entity_type: 'business_rules', entity_id: 'e', before: null, after: {}, actor: null, created_at: id }
}
function memStore(events: ContextEvent[]): EventStore & { dispatched: string[] } {
  const dispatched: string[] = []
  return {
    dispatched,
    async pending() { return events.filter(e => !dispatched.includes(e.id)) },
    async markDispatched(id) { dispatched.push(id) },
  }
}

describe('registry', () => {
  it('matches handlers by type prefix', () => {
    const r = createRegistry()
    const h = vi.fn()
    r.on('business_rules.', h)
    expect(r.handlersFor('business_rules.update')).toEqual([h])
    expect(r.handlersFor('org_people.insert')).toEqual([])
  })
})

describe('dispatchPendingEvents', () => {
  it('invokes matching handlers oldest-first and marks dispatched', async () => {
    const store = memStore([ev('1', 'business_rules.insert'), ev('2', 'business_rules.update')])
    const r = createRegistry()
    const seen: string[] = []
    r.on('business_rules.', async (e) => { seen.push(e.id) })
    const n = await dispatchPendingEvents(store, r)
    expect(n).toBe(2)
    expect(seen).toEqual(['1', '2'])
    expect(store.dispatched).toEqual(['1', '2'])
  })

  it('leaves an event undispatched if its handler throws (retryable)', async () => {
    const store = memStore([ev('1', 'business_rules.insert')])
    const r = createRegistry()
    r.on('business_rules.', async () => { throw new Error('boom') })
    await expect(dispatchPendingEvents(store, r)).rejects.toThrow('boom')
    expect(store.dispatched).toEqual([])
  })
})
