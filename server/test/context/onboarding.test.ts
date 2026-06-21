import { describe, it, expect, vi } from 'vitest'
import { supabaseOnboardingCompletionStore } from '../../src/context/onboarding.js'
import type { SupabaseClient } from '@supabase/supabase-js'

function makeDb(result: { data: unknown; error: null } | { data: null; error: { message: string } }) {
  return {
    rpc: vi.fn().mockResolvedValue(result),
  } as unknown as SupabaseClient
}

describe('supabaseOnboardingCompletionStore', () => {
  it('calls rpc with correct args and returns data', async () => {
    const fakeResult = {
      session_id: 's1',
      workspace_id: 'w1',
      invite_ids: [],
      completed_at: '2024-01-01T00:00:00Z',
    }
    const db = makeDb({ data: fakeResult, error: null })
    const store = supabaseOnboardingCompletionStore(db)

    const result = await store.complete('s1')

    expect(db.rpc).toHaveBeenCalledWith('complete_onboarding', { p_session_id: 's1' })
    expect(result).toEqual(fakeResult)
  })

  it('throws on rpc error', async () => {
    const db = makeDb({ data: null, error: { message: 'session not found' } })
    const store = supabaseOnboardingCompletionStore(db)

    await expect(store.complete('s1')).rejects.toThrow('complete onboarding: session not found')
  })
})
