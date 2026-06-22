export type RiskStatus = 'open' | 'mitigating' | 'accepted' | 'closed'

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Record<string, string> }

export interface RiskInput {
  id?: string
  version?: number
  title: string
  description?: string
  category?: string
  likelihood: number
  impact: number
  ownerPersonId?: string
  treatment?: string
  status?: RiskStatus
  reviewDate?: string
  frameworkId?: string
}

export interface RiskRow {
  id: string
  workspace_id: string
  version: number
  title: string
  description: string | null
  category: string | null
  likelihood: number
  impact: number
  owner_person_id: string | null
  treatment: string | null
  status: RiskStatus
  review_date: string | null
  framework_id: string | null
  created_at: string
  updated_at: string
}

export interface RiskStore {
  list(workspaceId: string): Promise<RiskRow[]>
  create(row: Omit<RiskRow, 'id' | 'version' | 'created_at' | 'updated_at'>): Promise<RiskRow>
  update(id: string, patch: Partial<RiskRow> & { version: number; updated_at: string }): Promise<RiskRow>
  getById(id: string): Promise<RiskRow | null>
}

export interface RiskServiceContext {
  workspaceId: string
  userId: string
}

export interface RiskService {
  list(ctx: RiskServiceContext): Promise<RiskRow[]>
  create(ctx: RiskServiceContext, input: unknown): Promise<RiskRow>
  update(ctx: RiskServiceContext, id: string, input: unknown): Promise<RiskRow>
  close(ctx: RiskServiceContext, id: string): Promise<RiskRow>
  linkRule(ctx: RiskServiceContext, riskId: string, ruleId: string): Promise<void>
}
