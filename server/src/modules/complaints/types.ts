export type ComplaintStatus = 'new' | 'in_progress' | 'resolved' | 'closed'
export type ComplaintChannel = 'phone' | 'email' | 'in_person' | 'web' | 'other'
export type ComplaintSeverity = 'low' | 'medium' | 'high'

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Record<string, string> }

export interface ComplaintInput {
  id?: string
  version?: number
  description: string
  channel?: ComplaintChannel
  severity?: ComplaintSeverity
  status?: ComplaintStatus
  category?: string | null
  customerId?: string
  notes?: string
}

export interface ComplaintRow {
  id: string
  workspace_id: string
  reference: string
  version: number
  description: string
  channel: ComplaintChannel | null
  severity: ComplaintSeverity
  status: ComplaintStatus
  category: string | null
  customer_id: string | null
  notes: string | null
  resolved_at: string | null
  received_at: string
  created_at: string
  updated_at: string
}

export interface ComplaintStore {
  list(workspaceId: string): Promise<ComplaintRow[]>
  create(row: Omit<ComplaintRow, 'id' | 'version' | 'created_at' | 'updated_at'>): Promise<ComplaintRow>
  update(id: string, patch: Partial<ComplaintRow> & { version: number; updated_at: string }): Promise<ComplaintRow>
  getById(id: string): Promise<ComplaintRow | null>
  countForWorkspace(workspaceId: string): Promise<number>
  countByCategorySince(workspaceId: string, category: string, sinceIso: string): Promise<number>
}

export interface ComplaintServiceContext {
  workspaceId: string
  userId: string
}

export interface ComplaintService {
  list(ctx: ComplaintServiceContext): Promise<ComplaintRow[]>
  create(ctx: ComplaintServiceContext, input: unknown): Promise<ComplaintRow>
  update(ctx: ComplaintServiceContext, id: string, input: unknown): Promise<ComplaintRow>
  resolve(ctx: ComplaintServiceContext, id: string): Promise<ComplaintRow>
  linkRule(ctx: ComplaintServiceContext, complaintId: string, ruleId: string): Promise<void>
  linkProcess(ctx: ComplaintServiceContext, complaintId: string, processId: string): Promise<void>
}
