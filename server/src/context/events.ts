export interface ContextEvent {
  id: string
  workspace_id: string
  type: string
  entity_type: string
  entity_id: string
  before: unknown
  after: unknown
  actor: string | null
  created_at: string
}

export interface EventStore {
  pending(): Promise<ContextEvent[]>
  markDispatched(id: string): Promise<void>
}

export type Handler = (e: ContextEvent) => Promise<void>

export function createRegistry() {
  const subs: { prefix: string; handler: Handler }[] = []
  return {
    on(prefix: string, handler: Handler) { subs.push({ prefix, handler }) },
    handlersFor(type: string): Handler[] {
      return subs.filter((s) => type.startsWith(s.prefix)).map((s) => s.handler)
    },
  }
}

export type Registry = ReturnType<typeof createRegistry>

export async function dispatchPendingEvents(store: EventStore, registry: Registry): Promise<number> {
  const events = await store.pending()
  let dispatched = 0
  for (const e of events) {
    for (const handler of registry.handlersFor(e.type)) {
      await handler(e) // throw → propagate; event stays undispatched (at-least-once)
    }
    await store.markDispatched(e.id)
    dispatched++
  }
  return dispatched
}
