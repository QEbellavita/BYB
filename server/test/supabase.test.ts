import { describe, it, expect } from 'vitest'
import { userScopedClient } from '../src/supabase.js'

const config = { supabaseUrl: 'http://127.0.0.1:54331', supabaseAnonKey: 'anon', supabaseServiceRoleKey: 'svc', port: 3001 }

describe('userScopedClient', () => {
  it('throws on a blank access token (fail-closed, not anon fallback)', () => {
    expect(() => userScopedClient(config, '')).toThrow(/access token/i)
  })
  it('builds a client when given a token', () => {
    expect(userScopedClient(config, 'jwt-xyz')).toBeTruthy()
  })
})
