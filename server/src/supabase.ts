import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { AppConfig } from './config.js'

// Requires Node 22+: createClient eagerly initialises @supabase/realtime-js, which
// throws on Node 20 ("native WebSocket support" required). Pinned via engines.node
// (root + server package.json) and .nvmrc; see docs/DEPLOY.md.

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
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}
