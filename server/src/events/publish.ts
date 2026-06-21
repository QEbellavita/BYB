import type { SupabaseClient } from '@supabase/supabase-js'
import type { EventStore } from '../context/events.js'
import { dispatchPendingEvents, type Registry } from '../context/events.js'

export interface PublishEvent {
  workspace_id: string
  type: string
  entity_type: string
  entity_id: string
  after?: unknown
  actor?: string | null
}

export type Publish = (e: PublishEvent) => Promise<void>

// Production publisher: insert into context_events outbox, then dispatch subscribers.
export function makePublish(db: SupabaseClient, store: EventStore, registry: Registry): Publish {
  return async (e) => {
    const { error } = await db.from('context_events').insert({
      workspace_id: e.workspace_id,
      type: e.type,
      entity_type: e.entity_type,
      entity_id: e.entity_id,
      after: e.after ?? null,
      actor: e.actor ?? null,
    })
    if (error) throw new Error(`publish ${e.type}: ${error.message}`)
    await dispatchPendingEvents(store, registry)
  }
}
