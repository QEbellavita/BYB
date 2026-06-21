import type { RequestHandler } from 'express'
import { requireAuth, type RequireAuthDeps } from './require-auth.js'
import { requireWorkspace, type RequireWorkspaceDeps } from './require-workspace.js'

export function authedWorkspaceRoute(deps: {
  auth: RequireAuthDeps
  workspace: RequireWorkspaceDeps
}): RequestHandler[] {
  return [requireAuth(deps.auth), requireWorkspace(deps.workspace)]
}
