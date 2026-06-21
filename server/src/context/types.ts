export type EntityStatus = 'draft' | 'active' | 'archived'

export interface HubRow {
  id: string
  workspace_id: string
  version: number
  status: EntityStatus
  created_by: string | null
  created_at: string
  updated_by: string | null
  updated_at: string
  approved_by: string | null
  approved_at: string | null
  supersedes: string | null
  [k: string]: unknown
}

export interface HubStore {
  insert(table: string, row: Record<string, unknown>): Promise<HubRow>
  update(table: string, id: string, patch: Record<string, unknown>): Promise<HubRow>
  getById(table: string, id: string): Promise<HubRow | null>
  select(table: string, filters: Record<string, unknown>): Promise<HubRow[]>
}
