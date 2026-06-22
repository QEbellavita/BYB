import { Router } from 'express'
import { authedWorkspaceRoute } from '../../middleware/authed-workspace.js'
import type { RequireAuthDeps } from '../../middleware/require-auth.js'
import type { RequireWorkspaceDeps } from '../../middleware/require-workspace.js'
import { StaleDraftError } from '../../errors.js'
import type { ComplaintService } from './types.js'

// ---------------------------------------------------------------------------
// Error handler helper
// ---------------------------------------------------------------------------

function handleError(err: unknown, res: import('express').Response): void {
  if (err instanceof StaleDraftError) {
    res.status(409).json({ error: 'draft changed; reload and retry' })
    return
  }
  if (
    err instanceof Error &&
    'errors' in err &&
    err.message === 'Validation failed'
  ) {
    res.status(400).json({ errors: (err as Error & { errors: unknown }).errors })
    return
  }
  // Status-transition errors (e.g. cannot resolve a closed complaint)
  if (err instanceof Error && err.message.startsWith('Cannot resolve')) {
    res.status(400).json({ error: err.message })
    return
  }
  console.error('Complaints route error:', err)
  res.status(500).json({ error: 'internal server error' })
}

// ---------------------------------------------------------------------------
// Router deps
// ---------------------------------------------------------------------------

export interface ComplaintsRouterDeps {
  /** Factory that produces a per-request RLS-scoped service from the bearer token. */
  makeService: (token: string) => ComplaintService
  auth: RequireAuthDeps
  workspace: RequireWorkspaceDeps
}

export function createComplaintsRouter(deps: ComplaintsRouterDeps): Router {
  const router = Router()
  const { makeService, auth, workspace } = deps

  const authWs = () => authedWorkspaceRoute({ auth, workspace })

  function resolveService(req: import('express').Request): ComplaintService {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    return makeService(token)
  }

  // GET /complaints
  router.get('/complaints', ...authWs(), async (req, res) => {
    try {
      const service = resolveService(req)
      const ctx = { workspaceId: req.workspaceId!, userId: req.user!.id }
      const complaints = await service.list(ctx)
      res.json({ complaints })
    } catch (err) {
      handleError(err, res)
    }
  })

  // POST /complaints
  router.post('/complaints', ...authWs(), async (req, res) => {
    try {
      const service = resolveService(req)
      const ctx = { workspaceId: req.workspaceId!, userId: req.user!.id }
      const row = await service.create(ctx, req.body)
      res.status(201).json(row)
    } catch (err) {
      handleError(err, res)
    }
  })

  // PUT /complaints/:id
  router.put('/complaints/:id', ...authWs(), async (req, res) => {
    try {
      const service = resolveService(req)
      const ctx = { workspaceId: req.workspaceId!, userId: req.user!.id }
      const row = await service.update(ctx, req.params.id, req.body)
      res.json(row)
    } catch (err) {
      handleError(err, res)
    }
  })

  // POST /complaints/:id/resolve
  router.post('/complaints/:id/resolve', ...authWs(), async (req, res) => {
    try {
      const service = resolveService(req)
      const ctx = { workspaceId: req.workspaceId!, userId: req.user!.id }
      const row = await service.resolve(ctx, req.params.id)
      res.json(row)
    } catch (err) {
      handleError(err, res)
    }
  })

  return router
}
