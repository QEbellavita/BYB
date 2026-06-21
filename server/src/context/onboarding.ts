import type { SupabaseClient } from '@supabase/supabase-js'

export interface CompletionResult {
  session_id: string
  workspace_id: string
  invite_ids: { id: string; email: string; token: string }[]
  completed_at: string
}

export interface CompletionStore {
  complete(sessionId: string): Promise<CompletionResult>
}

export function supabaseOnboardingCompletionStore(db: SupabaseClient): CompletionStore {
  return {
    async complete(sessionId: string): Promise<CompletionResult> {
      const { data, error } = await db.rpc('complete_onboarding', { p_session_id: sessionId })
      if (error) throw new Error(`complete onboarding: ${error.message}`)
      return data as CompletionResult
    },
  }
}
