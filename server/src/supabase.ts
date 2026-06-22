import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { AppConfig } from './config.js'

export function anonClient(config: AppConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function serviceClient(config: AppConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// A per-request client carrying the user's JWT so Postgres RLS applies.
export function userScopedClient(config: AppConfig, accessToken: string): SupabaseClient {
  if (!accessToken || !accessToken.trim()) {
    throw new Error('userScopedClient requires a non-empty access token')
  }
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}
