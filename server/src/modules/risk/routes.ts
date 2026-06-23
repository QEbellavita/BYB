import { Router } from 'express'
import { requireAuth, type RequireAuthDeps } from '../../middleware/require-auth.js'
import { authedWorkspaceRoute } from '../../middleware/authed-workspace.js'
import type { RequireWorkspaceDeps } from '../../middleware/require-workspace.js'
import { StaleDraftError } from '../../errors.js'
import type { RiskService } from './types.js'

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
  console.error('Risk route error:', err)
  res.status(500).json({ error: 'internal server error' })
}

// ---------------------------------------------------------------------------
// Router deps
// ---------------------------------------------------------------------------

export interface RiskRouterDeps {
  /** Factory that produces a per-request RLS-scoped service from the bearer token. */
  makeService: (token: string) => RiskService
  auth: RequireAuthDeps
  workspace: RequireWorkspaceDeps
}

export function createRiskRouter(deps: RiskRouterDeps): Router {
  const router = Router()
  const { makeService, auth, workspace } = deps

  const authWs = () => authedWorkspaceRoute({ auth, workspace })

  function resolveService(req: import('express').Request): RiskService {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    return makeService(token)
  }

  // GET /risks
  router.get('/risks', ...authWs(), async (req, res) => {
    try {
      const service = resolveService(req)
      const ctx = { workspaceId: req.workspaceId!, userId: req.user!.id }
      const risks = await service.list(ctx)
      res.json({ risks })
    } catch (err) {
      handleError(err, res)
    }
  })

  // POST /risks
  router.post('/risks', ...authWs(), async (req, res) => {
    try {
      const service = resolveService(req)
      const ctx = { workspaceId: req.workspaceId!, userId: req.user!.id }
      const row = await service.create(ctx, req.body)
      res.status(201).json(row)
    } catch (err) {
      handleError(err, res)
    }
  })

  // PUT /risks/:id
  router.put('/risks/:id', ...authWs(), async (req, res) => {
    try {
      const service = resolveService(req)
      const ctx = { workspaceId: req.workspaceId!, userId: req.user!.id }
      const row = await service.update(ctx, req.params.id as string, req.body)
      res.json(row)
    } catch (err) {
      handleError(err, res)
    }
  })

  // POST /risks/:id/close
  router.post('/risks/:id/close', ...authWs(), async (req, res) => {
    try {
      const service = resolveService(req)
      const ctx = { workspaceId: req.workspaceId!, userId: req.user!.id }
      const row = await service.close(ctx, req.params.id as string)
      res.json(row)
    } catch (err) {
      handleError(err, res)
    }
  })

  // POST /risks/:id/link-rule
  router.post('/risks/:id/link-rule', ...authWs(), async (req, res) => {
    try {
      const service = resolveService(req)
      const ctx = { workspaceId: req.workspaceId!, userId: req.user!.id }
      const { ruleId } = req.body as { ruleId: string }
      if (!ruleId) {
        res.status(400).json({ error: 'ruleId is required' })
        return
      }
      await service.linkRule(ctx, req.params.id as string, ruleId)
      res.json({ ok: true })
    } catch (err) {
      handleError(err, res)
    }
  })

  return router
}
