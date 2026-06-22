import { Router } from 'express'
import type { AppConfig } from '../config.js'
import { requireAuth } from '../middleware/require-auth.js'
import { requireWorkspace } from '../middleware/require-workspace.js'
import { requireWorkspaceAdmin } from '../middleware/require-workspace-admin.js'
import { userScopedClient } from '../supabase.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuditRecorder } from '../services/audit.js'

// Injectable deps for unit-testing without a live DB.
export interface AuditRouterDeps {
  auth: { getUser: (token: string) => Promise<{ id: string; email: string | null } | null> }
  workspace: { getMembership: (token: string, workspaceId: string) => Promise<{ role: string; permissions: Record<string, unknown> } | null> }
  /** Audit recorder — records authz.denied events from requireWorkspaceAdmin. */
  audit?: AuditRecorder
  /** Override the Supabase client factory — used by unit tests to inject fakes.
   *  MUST be a user-scoped (anon key + JWT) client in production — never service-role — so RLS applies. */
  makeClient?: (config: AppConfig, accessToken: string) => Pick<SupabaseClient, 'from'>
}

export function auditRouter(config: AppConfig, deps?: AuditRouterDeps): Router {
  const router = Router()

  // Build auth middleware chain with injected or real dependencies.
  const authMiddleware = requireAuth({ getUser: deps?.auth.getUser ?? defaultGetUser(config) })
  const workspaceMiddleware = requireWorkspace({
    getMembership: deps?.workspace.getMembership ?? defaultGetMembership(config),
  })
  const adminMiddleware = requireWorkspaceAdmin({ audit: deps?.audit })

  const clientFactory = deps?.makeClient ?? ((_cfg: AppConfig, token: string) => userScopedClient(_cfg, token))

  router.get(
    '/',
    authMiddleware,
    workspaceMiddleware,
    adminMiddleware,
    async (req, res) => {
      let limit = 50
      if (req.query.limit !== undefined) {
        const n = Number(req.query.limit)
        if (!Number.isInteger(n) || n <= 0) return res.status(400).json({ error: '?limit must be a positive integer' })
        limit = Math.min(n, 200)
      }

      const db = clientFactory(config, req.accessToken!)

      let query = db
        .from('audit_log')
        .select('*')
        .eq('workspace_id', req.workspaceId!)
        .order('id', { ascending: false })
        .limit(limit)

      if (req.query.before !== undefined) {
        const before = Number(req.query.before)
        if (!Number.isInteger(before) || before <= 0) {
          return res.status(400).json({ error: '?before must be a positive integer' })
        }
        query = (query as ReturnType<typeof query.lt>).lt('id', before)
      }

      const { data, error } = await query

      if (error) {
        console.error('[audit] read failed:', error.message)
        return res.status(500).json({ error: 'failed to read audit log' })
      }

      const entries = data ?? []
      const nextCursor = entries.length ? (entries[entries.length - 1] as Record<string, unknown>).id ?? null : null

      return res.json({ entries, nextCursor })
    },
  )

  return router
}

// ---------------------------------------------------------------------------
// Production dependency builders (only used when deps are not injected)
// ---------------------------------------------------------------------------

function defaultGetUser(_config: AppConfig) {
  // In production, app.ts wires up its own anonClient-backed getUser and
  // passes it through the authDeps. For this factory the caller (app.ts)
  // passes a fully constructed deps object, so this path is only hit in
  // pathological standalone use. We return a rejected stub.
  return async (_token: string) => null as { id: string; email: string | null } | null
}

function defaultGetMembership(_config: AppConfig) {
  return async (_token: string, _workspaceId: string) =>
    null as { role: string; permissions: Record<string, unknown> } | null
}
