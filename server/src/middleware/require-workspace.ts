import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { AppConfig } from '../config.js'
import { userScopedClient } from '../supabase.js'

export interface Membership {
  role: string
  permissions: { granted?: string[]; revoked?: string[] }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      workspaceId?: string
      member?: Membership
    }
  }
}

export interface RequireWorkspaceDeps {
  getMembership: (accessToken: string, workspaceId: string) => Promise<Membership | null>
}

// Production dependency: query workspace_members through the RLS-scoped client.
export function supabaseMembershipLookup(config: AppConfig): RequireWorkspaceDeps['getMembership'] {
  return async (accessToken, workspaceId) => {
    const db = userScopedClient(config, accessToken)
    const { data, error } = await db
      .from('workspace_members')
      .select('role, permissions')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (error || !data) return null
    return { role: data.role as string, permissions: (data.permissions ?? {}) as Membership['permissions'] }
  }
}

export function requireWorkspace(deps: RequireWorkspaceDeps): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.accessToken) {
      return res.status(500).json({ error: 'requireWorkspace requires requireAuth to run first' })
    }
    const workspaceId = req.header('x-workspace-id') ?? ''
    if (!workspaceId) return res.status(400).json({ error: 'missing x-workspace-id' })
    const member = await deps.getMembership(req.accessToken ?? '', workspaceId)
    if (!member) return res.status(403).json({ error: 'not a workspace member' })
    req.workspaceId = workspaceId
    req.member = member
    next()
  }
}
