export type OnboardingStep = 'profile' | 'rules' | 'industry' | 'people' | 'review'

export type PlatformRole = 'owner' | 'admin' | 'manager' | 'compliance_officer' | 'accountant' | 'staff'

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
  obligations: ObligationInput[]
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

export interface WorkspaceInfo {
  id: string
  name: string
  role: string
  onboardingStatus: 'not_started' | 'in_progress' | 'completed'
}

export interface BootstrapResult {
  workspaces: WorkspaceInfo[]
}

export interface CreateWorkspaceResult {
  workspaceId: string
}

export interface OnboardingSnapshot {
  session: {
    id: string
    workspace_id: string
    user_id: string
    current_step: OnboardingStep
    completed_steps: OnboardingStep[]
    created_at: string
    updated_at: string
  }
  profile: Record<string, unknown> | null
  rules: Record<string, unknown>[]
  obligations: Record<string, unknown>[]
  people: Record<string, unknown>[]
}

export interface FinishResult {
  workspaceId: string
  completedAt: string
  invitesSent: number
  invitesFailed: number
}
