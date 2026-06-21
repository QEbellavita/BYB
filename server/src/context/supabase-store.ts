import type { SupabaseClient } from '@supabase/supabase-js'
import type { HubRow, HubStore } from './types.js'
import type { ContextLink, LinkRef, LinkStore } from './links.js'
import type { ContextEvent, EventStore } from './events.js'

export function supabaseHubStore(db: SupabaseClient): HubStore {
  return {
    async insert(table, row) {
      const { data, error } = await db.from(table).insert(row).select().single()
      if (error) throw new Error(`hub insert ${table}: ${error.message}`)
      return data as HubRow
    },
    async update(table, id, patch) {
      const { data, error } = await db.from(table).update(patch).eq('id', id).select().single()
      if (error) throw new Error(`hub update ${table}: ${error.message}`)
      return data as HubRow
    },
    async getById(table, id) {
      const { data, error } = await db.from(table).select('*').eq('id', id).maybeSingle()
      if (error) throw new Error(`hub get ${table}: ${error.message}`)
      return (data as HubRow) ?? null
    },
    async select(table, filters) {
      let q = db.from(table).select('*')
      for (const [k, v] of Object.entries(filters)) q = q.eq(k, v as never)
      const { data, error } = await q
      if (error) throw new Error(`hub select ${table}: ${error.message}`)
      return (data as HubRow[]) ?? []
    },
  }
}

export function supabaseLinkStore(db: SupabaseClient): LinkStore {
  return {
    async insertLink(row) {
      const { data, error } = await db.from('context_links').insert(row).select().single()
      if (error) throw new Error(`link insert: ${error.message}`)
      return data as ContextLink
    },
    async selectLinks(workspaceId, ref?: LinkRef) {
      let q = db.from('context_links').select('*').eq('workspace_id', workspaceId)
      if (ref) q = q.eq('from_type', ref.type).eq('from_id', ref.id)
      const { data, error } = await q
      if (error) throw new Error(`link list: ${error.message}`)
      return (data as ContextLink[]) ?? []
    },
    async deleteLink(id) {
      const { error } = await db.from('context_links').delete().eq('id', id)
      if (error) throw new Error(`link delete: ${error.message}`)
    },
  }
}

export function supabaseEventStore(db: SupabaseClient): EventStore {
  return {
    async pending() {
      const { data, error } = await db.from('context_events').select('*')
        .is('dispatched_at', null).order('created_at', { ascending: true })
      if (error) throw new Error(`events pending: ${error.message}`)
      return (data as ContextEvent[]) ?? []
    },
    async markDispatched(id) {
      const { error } = await db.from('context_events').update({ dispatched_at: new Date().toISOString() }).eq('id', id)
      if (error) throw new Error(`events markDispatched: ${error.message}`)
    },
  }
}
