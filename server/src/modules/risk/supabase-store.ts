import type { SupabaseClient } from '@supabase/supabase-js'
import type { RiskRow, RiskStore } from './types.js'
import type { Severity } from './severity.js'

function mapRow(row: Record<string, unknown>): RiskRow {
  return {
    id: row['id'] as string,
    workspace_id: row['workspace_id'] as string,
    version: row['version'] as number,
    title: row['title'] as string,
    description: (row['description'] ?? null) as string | null,
    category: (row['category'] ?? null) as string | null,
    likelihood: row['likelihood'] as number,
    impact: row['impact'] as number,
    severity: row['severity'] as Severity,
    owner_person_id: (row['owner_person_id'] ?? null) as string | null,
    treatment: (row['treatment'] ?? null) as string | null,
    status: row['status'] as RiskRow['status'],
    review_date: (row['review_date'] ?? null) as string | null,
    framework_id: (row['framework_id'] ?? null) as string | null,
    created_at: (row['created_at'] ?? '') as string,
    updated_at: (row['updated_at'] ?? '') as string,
  }
}

export function supabaseRiskStore(db: SupabaseClient): RiskStore {
  return {
    async list(workspaceId) {
      const { data, error } = await db
        .from('risk_entries')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
      if (error) throw new Error(`risk list: ${error.message}`)
      return ((data ?? []) as Record<string, unknown>[]).map(mapRow)
    },

    async create(row) {
      const { data, error } = await db
        .from('risk_entries')
        .insert(row)
        .select()
        .single()
      if (error) throw new Error(`risk create: ${error.message}`)
      return mapRow(data as Record<string, unknown>)
    },

    async update(id, patch) {
      const { data, error } = await db
        .from('risk_entries')
        .update(patch)
        .eq('id', id)
        .select()
        .single()
      if (error) throw new Error(`risk update: ${error.message}`)
      return mapRow(data as Record<string, unknown>)
    },

    async getById(id) {
      const { data, error } = await db
        .from('risk_entries')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) throw new Error(`risk getById: ${error.message}`)
      if (!data) return null
      return mapRow(data as Record<string, unknown>)
    },
  }
}
