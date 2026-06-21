import { Router } from 'express'
import { authedWorkspaceRoute } from '../../middleware/authed-workspace.js'
import type { RequireAuthDeps } from '../../middleware/require-auth.js'
import type { RequireWorkspaceDeps } from '../../middleware/require-workspace.js'
import { StaleDraftError } from '../../errors.js'
import type { ImprovementService } from './types.js'

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
  console.error('Improvements route error:', err)
  res.status(500).json({ error: 'internal server error' })
}

// ---------------------------------------------------------------------------
// Router deps
// ---------------------------------------------------------------------------

export interface ImprovementsRouterDeps {
  service: ImprovementService
  auth: RequireAuthDeps
  workspace: RequireWorkspaceDeps
}

export function createImprovementsRouter(deps: ImprovementsRouterDeps): Router {
  const router = Router()
  const { service, auth, workspace } = deps

  const authWs = () => authedWorkspaceRoute({ auth, workspace })

  // GET /improvements
  router.get('/improvements', ...authWs(), async (req, res) => {
    try {
      const ctx = { workspaceId: req.workspaceId!, userId: req.user!.id }
      const status = req.query['status'] as string | undefined
      const improvements = await service.list(ctx, status)
      res.json({ improvements })
    } catch (err) {
      handleError(err, res)
    }
  })

  // POST /improvements
  router.post('/improvements', ...authWs(), async (req, res) => {
    try {
      const ctx = { workspaceId: req.workspaceId!, userId: req.user!.id }
      const row = await service.create(ctx, req.body)
      res.status(201).json(row)
    } catch (err) {
      handleError(err, res)
    }
  })

  // PUT /improvements/:id
  router.put('/improvements/:id', ...authWs(), async (req, res) => {
    try {
      const ctx = { workspaceId: req.workspaceId!, userId: req.user!.id }
      const row = await service.update(ctx, req.params.id, req.body)
      res.json(row)
    } catch (err) {
      handleError(err, res)
    }
  })

  // POST /improvements/:id/status
  router.post('/improvements/:id/status', ...authWs(), async (req, res) => {
    try {
      const ctx = { workspaceId: req.workspaceId!, userId: req.user!.id }
      const { status } = req.body as { status: string }
      if (!status) {
        res.status(400).json({ errors: { status: 'Required' } })
        return
      }
      const row = await service.setStatus(ctx, req.params.id, status)
      res.json(row)
    } catch (err) {
      handleError(err, res)
    }
  })

  return router
}
