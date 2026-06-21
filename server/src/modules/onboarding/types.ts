export type OnboardingStep = 'profile' | 'rules' | 'industry' | 'people' | 'review'

export type PlatformRole = 'owner' | 'admin' | 'manager' | 'compliance_officer' | 'accountant' | 'staff'

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Record<string, string> }

export interface ProfileInput {
  name: string
  jurisdiction: 'AU' | 'NZ'
  size: string
  description: string
}

export interface RuleInput {
  id?: string
  version?: number
  ruleType: 'business_rule' | 'value_setting' | 'must_do'
  area: string
  statement: string
  operator: string | null
  value: unknown
  consequence: string
  appliesTo: string[]
}

export interface ObligationInput {
  id?: string
  version?: number
  name: string
  description: string
}

export interface IndustryInput {
  anzsicCode: string
  obligations?: ObligationInput[]
}

export interface PersonInput {
  id?: string
  version?: number
  personName: string
  title: string
  email: string
  responsibilities: string[]
  role: PlatformRole
  accessScope: Record<string, unknown>
  invite: boolean
}

export interface OnboardingSession {
  id: string
  workspace_id: string
  user_id: string
  current_step: OnboardingStep
  completed_steps: OnboardingStep[]
  created_at: string
  updated_at: string
}

export interface InviteDraft {
  id: string
  session_id: string
  workspace_id: string
  org_person_id: string
  email: string
  role: PlatformRole
  status: 'queued' | 'committed' | 'sent' | 'failed'
  invite_id: string | null
  token?: string
  created_at: string
  updated_at: string
}

export interface InviteDraftInput {
  org_person_id: string
  email: string
  role: PlatformRole
  access_scope?: Record<string, unknown>
}

export interface OnboardingContext {
  workspaceId: string
  userId: string
  sessionId: string
}

export interface OnboardingSnapshot {
  session: OnboardingSession
  profile: Record<string, unknown> | null
  rules: Record<string, unknown>[]
  obligations: Record<string, unknown>[]
  people: Record<string, unknown>[]
  inviteDrafts: InviteDraft[]
}

export interface FinishResult {
  workspaceId: string
  completedAt: string
  invitesSent: number
  invitesFailed: number
}

export interface OnboardingStore {
  createSession(workspaceId: string, userId: string): Promise<OnboardingSession>
  getSession(workspaceId: string): Promise<OnboardingSession | null>
  updateProgress(sessionId: string, currentStep: OnboardingStep, completedSteps: OnboardingStep[]): Promise<OnboardingSession>
  listInviteDrafts(sessionId: string): Promise<InviteDraft[]>
  reconcileInviteDrafts(sessionId: string, workspaceId: string, rows: InviteDraftInput[]): Promise<InviteDraft[]>
  markInviteDelivery(id: string, status: 'sent' | 'failed'): Promise<void>
}

export interface OnboardingService {
  load(ctx: OnboardingContext): Promise<OnboardingSnapshot>
  saveProfile(ctx: OnboardingContext, input: unknown): Promise<OnboardingSnapshot>
  saveRules(ctx: OnboardingContext, input: unknown): Promise<OnboardingSnapshot>
  saveIndustry(ctx: OnboardingContext, input: unknown): Promise<OnboardingSnapshot>
  savePeople(ctx: OnboardingContext, input: unknown): Promise<OnboardingSnapshot>
  finish(ctx: OnboardingContext): Promise<FinishResult>
  retryInvitation(ctx: OnboardingContext, inviteDraftId: string): Promise<void>
}
