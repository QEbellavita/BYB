import type { SupabaseClient } from '@supabase/supabase-js'
import type { ImprovementRow, ImprovementStore, ImprovementStatus, AutoSuggestionRow } from './types.js'

function mapRow(row: Record<string, unknown>): ImprovementRow {
  return {
    id: row['id'] as string,
    workspace_id: row['workspace_id'] as string,
    version: row['version'] as number,
    title: row['title'] as string,
    suggested_change: (row['suggested_change'] ?? null) as string | null,
    detail: (row['detail'] ?? null) as string | null,
    source: row['source'] as ImprovementRow['source'],
    status: row['status'] as ImprovementRow['status'],
    trigger_kind: (row['trigger_kind'] ?? null) as ImprovementRow['trigger_kind'],
    dedup_key: (row['dedup_key'] ?? null) as string | null,
    source_ref: (row['source_ref'] ?? null) as Record<string, unknown> | null,
    created_at: (row['created_at'] ?? '') as string,
    updated_at: (row['updated_at'] ?? '') as string,
  }
}

export function supabaseImprovementsStore(db: SupabaseClient): ImprovementStore {
  return {
    async list(workspaceId, status?: ImprovementStatus) {
      let query = db
        .from('improvements')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
      if (status) {
        query = query.eq('status', status)
      }
      const { data, error } = await query
      if (error) throw new Error(`improvements list: ${error.message}`)
      return ((data ?? []) as Record<string, unknown>[]).map(mapRow)
    },

    async create(row) {
      const { data, error } = await db
        .from('improvements')
        .insert(row)
        .select()
        .single()
      if (error) throw new Error(`improvements create: ${error.message}`)
      return mapRow(data as Record<string, unknown>)
    },

    async update(id, patch) {
      const { data, error } = await db
        .from('improvements')
        .update(patch)
        .eq('id', id)
        .select()
        .single()
      if (error) throw new Error(`improvements update: ${error.message}`)
      return mapRow(data as Record<string, unknown>)
    },

    async getById(id) {
      const { data, error } = await db
        .from('improvements')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) throw new Error(`improvements getById: ${error.message}`)
      if (!data) return null
      return mapRow(data as Record<string, unknown>)
    },

    async upsertAuto(row: AutoSuggestionRow) {
      // Idempotent: only insert if no OPEN auto row with same (workspace_id, dedup_key) exists
      // Relies on partial unique index: improvements_auto_open_uniq
      const { data: existing } = await db
        .from('improvements')
        .select('id')
        .eq('workspace_id', row.workspace_id)
        .eq('dedup_key', row.dedup_key)
        .eq('source', 'auto')
        .eq('status', 'open')
        .maybeSingle()

      if (existing) return // Already exists — idempotent, skip

      const insertRow = {
        workspace_id: row.workspace_id,
        source: 'auto' as const,
        status: 'open' as const,
        trigger_kind: row.trigger_kind,
        dedup_key: row.dedup_key,
        title: row.title,
        suggested_change: row.suggested_change ?? null,
        source_ref: row.source_ref ?? null,
      }

      const { error } = await db.from('improvements').insert(insertRow)
      if (error) {
        if ((error as { code?: string }).code === '23505') return // concurrent duplicate — already exists, no-op
        throw new Error(`improvements upsertAuto: ${error.message}`)
      }
    },

    async clearAuto(workspaceId: string, dedupKey: string) {
      // Set matching OPEN auto rows to 'done'
      const { error } = await db
        .from('improvements')
        .update({ status: 'done', updated_at: new Date().toISOString() })
        .eq('workspace_id', workspaceId)
        .eq('dedup_key', dedupKey)
        .eq('source', 'auto')
        .eq('status', 'open')
      if (error) throw new Error(`improvements clearAuto: ${error.message}`)
    },
  }
}
