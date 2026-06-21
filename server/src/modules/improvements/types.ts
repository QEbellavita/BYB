export type ImprovementStatus = 'open' | 'actioned' | 'dismissed' | 'done'
export type ImprovementSource = 'manual' | 'auto'
export type ImprovementTriggerKind =
  | 'untreated_high_risk'
  | 'overdue_risk_review'
  | 'recurring_complaints'

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Record<string, string> }

export interface ImprovementInput {
  id?: string
  version?: number
  title: string
  suggested_change?: string
  source?: ImprovementSource
  status?: ImprovementStatus
}

export interface ImprovementRow {
  id: string
  workspace_id: string
  version: number
  title: string
  suggested_change: string | null
  source: ImprovementSource
  status: ImprovementStatus
  trigger_kind: ImprovementTriggerKind | null
  dedup_key: string | null
  source_ref: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface AutoSuggestionRow {
  workspace_id: string
  source: 'auto'
  trigger_kind: ImprovementTriggerKind
  dedup_key: string
  title: string
  suggested_change?: string
  source_ref?: Record<string, unknown>
}

export interface ImprovementStore {
  list(workspaceId: string, status?: ImprovementStatus): Promise<ImprovementRow[]>
  create(row: Omit<ImprovementRow, 'id' | 'version' | 'created_at' | 'updated_at'>): Promise<ImprovementRow>
  update(id: string, patch: Partial<ImprovementRow> & { version: number; updated_at: string }): Promise<ImprovementRow>
  getById(id: string): Promise<ImprovementRow | null>
  upsertAuto(row: AutoSuggestionRow): Promise<void>
  clearAuto(workspaceId: string, dedupKey: string): Promise<void>
}

export interface ImprovementServiceContext {
  workspaceId: string
  userId: string
}

export interface ImprovementService {
  list(ctx: ImprovementServiceContext, status?: string): Promise<ImprovementRow[]>
  create(ctx: ImprovementServiceContext, input: unknown): Promise<ImprovementRow>
  update(ctx: ImprovementServiceContext, id: string, input: unknown): Promise<ImprovementRow>
  setStatus(ctx: ImprovementServiceContext, id: string, status: string): Promise<ImprovementRow>
}
