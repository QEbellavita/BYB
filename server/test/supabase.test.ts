import { describe, it, expect, vi } from 'vitest'

// Mock createClient so this unit test never constructs a real Supabase client.
// supabase-js eagerly initialises @supabase/realtime-js, which throws on Node 20
// ("native WebSocket support" required) — and constructing a live client is not
// what this test is about. We assert the guard + that the token is forwarded.
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ __mockClient: true })),
}))

import { userScopedClient } from '../src/supabase.js'
import { createClient } from '@supabase/supabase-js'

const config = { supabaseUrl: 'http://127.0.0.1:54331', supabaseAnonKey: 'anon', supabaseServiceRoleKey: 'svc', port: 3001 }

describe('userScopedClient', () => {
  it('throws on a blank access token (fail-closed, not anon fallback)', () => {
    expect(() => userScopedClient(config, '')).toThrow(/access token/i)
  })
  it('throws on a whitespace-only access token (fail-closed)', () => {
    expect(() => userScopedClient(config, '   ')).toThrow(/access token/i)
  })
  it('forwards a valid token as a Bearer Authorization header', () => {
    const client = userScopedClient(config, 'jwt-xyz')
    expect(client).toBeTruthy()
    expect(createClient).toHaveBeenCalledWith(
      config.supabaseUrl,
      config.supabaseAnonKey,
      expect.objectContaining({
        global: { headers: { Authorization: 'Bearer jwt-xyz' } },
      })
    )
  })
})
