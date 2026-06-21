import type { SupabaseClient } from '@supabase/supabase-js'
import type { OnboardingSession, OnboardingStore, InviteDraft, InviteDraftInput } from './types.js'

// Maps DB rows to the OnboardingSession type (handles column name differences)
function mapSession(row: Record<string, unknown>): OnboardingSession {
  return {
    id: row.id as string,
    workspace_id: row.workspace_id as string,
    user_id: (row.started_by ?? row.user_id ?? '') as string,
    current_step: (row.current_step ?? 'profile') as OnboardingSession['current_step'],
    completed_steps: (row.completed_steps ?? []) as OnboardingSession['completed_steps'],
    created_at: (row.started_at ?? row.created_at ?? '') as string,
    updated_at: (row.updated_at ?? '') as string,
  }
}

// Maps DB invite draft rows to InviteDraft type
function mapInviteDraft(row: Record<string, unknown>): InviteDraft {
  // token may come from an embedded workspace_invites join
  const joinedInvite = row.workspace_invites as Record<string, unknown> | null | undefined
  return {
    id: row.id as string,
    session_id: row.session_id as string,
    workspace_id: row.workspace_id as string,
    org_person_id: row.org_person_id as string,
    email: row.email as string,
    role: row.role as InviteDraft['role'],
    status: (row.status ?? 'queued') as InviteDraft['status'],
    invite_id: (row.invite_id ?? null) as string | null,
    token: joinedInvite?.token as string | undefined,
    created_at: (row.created_at ?? '') as string,
    updated_at: (row.updated_at ?? '') as string,
  }
}

export function supabaseOnboardingStore(db: SupabaseClient): OnboardingStore {
  return {
    async createSession(workspaceId, userId) {
      const { data, error } = await db
        .from('onboarding_sessions')
        .insert({ workspace_id: workspaceId, started_by: userId, current_step: 'profile', completed_steps: [] })
        .select()
        .single()
      if (error) throw new Error(`createSession: ${error.message}`)
      return mapSession(data as Record<string, unknown>)
    },

    async getSession(workspaceId) {
      const { data, error } = await db
        .from('onboarding_sessions')
        .select('*')
        .eq('workspace_id', workspaceId)
        .maybeSingle()
      if (error) throw new Error(`getSession: ${error.message}`)
      if (!data) return null
      return mapSession(data as Record<string, unknown>)
    },

    async updateProgress(sessionId, currentStep, completedSteps) {
      const { data, error } = await db
        .from('onboarding_sessions')
        .update({ current_step: currentStep, completed_steps: completedSteps, updated_at: new Date().toISOString() })
        .eq('id', sessionId)
        .select()
        .single()
      if (error) throw new Error(`updateProgress: ${error.message}`)
      return mapSession(data as Record<string, unknown>)
    },

    async listInviteDrafts(sessionId) {
      const { data, error } = await db
        .from('onboarding_invite_drafts')
        .select('*, workspace_invites(token)')
        .eq('session_id', sessionId)
      if (error) throw new Error(`listInviteDrafts: ${error.message}`)
      return ((data ?? []) as Record<string, unknown>[]).map(mapInviteDraft)
    },

    async reconcileInviteDrafts(sessionId, workspaceId, rows: InviteDraftInput[]) {
      // Upsert each draft by (session_id, org_person_id) — the real unique constraint
      const results: InviteDraft[] = []
      for (const row of rows) {
        const { data, error } = await db
          .from('onboarding_invite_drafts')
          .upsert(
            {
              session_id: sessionId,
              workspace_id: workspaceId,
              org_person_id: row.org_person_id,
              email: row.email,
              role: row.role,
              access_scope: row.access_scope ?? {},
              status: 'queued',
            },
            { onConflict: 'session_id,org_person_id' }
          )
          .select('*, workspace_invites(token)')
          .single()
        if (error) throw new Error(`reconcileInviteDrafts: ${error.message}`)
        results.push(mapInviteDraft(data as Record<string, unknown>))
      }
      return results
    },

    async markInviteDelivery(id, status) {
      // `id` here is workspace_invites.id (from complete_onboarding RPC result)
      // Update the onboarding_invite_drafts row that has this invite_id
      const { error } = await db
        .from('onboarding_invite_drafts')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('invite_id', id)
      if (error) throw new Error(`markInviteDelivery: ${error.message}`)
    },
  }
}
