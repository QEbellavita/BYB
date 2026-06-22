import type { SupabaseClient } from '@supabase/supabase-js'
import type { ComplaintRow, ComplaintStore } from './types.js'

function mapRow(row: Record<string, unknown>): ComplaintRow {
  return {
    id: row['id'] as string,
    workspace_id: row['workspace_id'] as string,
    reference: row['reference'] as string,
    version: row['version'] as number,
    complainant_name: (row['complainant_name'] ?? null) as string | null,
    complainant_contact: (row['complainant_contact'] ?? null) as string | null,
    channel: (row['channel'] ?? null) as ComplaintRow['channel'],
    received_at: (row['received_at'] ?? '') as string,
    description: row['description'] as string,
    category: (row['category'] ?? null) as string | null,
    severity: row['severity'] as ComplaintRow['severity'],
    assignee_person_id: (row['assignee_person_id'] ?? null) as string | null,
    status: row['status'] as ComplaintRow['status'],
    resolution_notes: (row['resolution_notes'] ?? null) as string | null,
    resolved_at: (row['resolved_at'] ?? null) as string | null,
    created_at: (row['created_at'] ?? '') as string,
    updated_at: (row['updated_at'] ?? '') as string,
  }
}

export function supabaseComplaintsStore(db: SupabaseClient): ComplaintStore {
  return {
    async list(workspaceId) {
      const { data, error } = await db
        .from('complaints')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
      if (error) throw new Error(`complaints list: ${error.message}`)
      return ((data ?? []) as Record<string, unknown>[]).map(mapRow)
    },

    async create(row) {
      const { data, error } = await db
        .from('complaints')
        .insert(row)
        .select()
        .single()
      if (error) throw new Error(`complaints create: ${error.message}`)
      return mapRow(data as Record<string, unknown>)
    },

    async update(id, patch) {
      const { data, error } = await db
        .from('complaints')
        .update(patch)
        .eq('id', id)
        .select()
        .single()
      if (error) throw new Error(`complaints update: ${error.message}`)
      return mapRow(data as Record<string, unknown>)
    },

    async getById(id) {
      const { data, error } = await db
        .from('complaints')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) throw new Error(`complaints getById: ${error.message}`)
      if (!data) return null
      return mapRow(data as Record<string, unknown>)
    },

    async countForWorkspace(workspaceId) {
      const { count, error } = await db
        .from('complaints')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
      if (error) throw new Error(`complaints countForWorkspace: ${error.message}`)
      return count ?? 0
    },

    async countByCategorySince(workspaceId, category, sinceIso) {
      const { count, error } = await db
        .from('complaints')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('category', category)
        .gte('received_at', sinceIso)
        .neq('status', 'closed')
      if (error) throw new Error(`complaints countByCategorySince: ${error.message}`)
      return count ?? 0
    },
  }
}
