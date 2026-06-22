import { Router } from 'express'
import { requireAuth, type RequireAuthDeps } from '../../middleware/require-auth.js'
import { authedWorkspaceRoute } from '../../middleware/authed-workspace.js'
import type { RequireWorkspaceDeps } from '../../middleware/require-workspace.js'
import { requireWorkspaceAdmin } from '../../middleware/require-workspace-admin.js'
import { StaleDraftError } from './service.js'
import type { OnboardingService, OnboardingStore } from './types.js'

// ---------------------------------------------------------------------------
// Error handler helper — centralised mapping for route handlers
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
  console.error('Onboarding route error:', err)
  res.status(500).json({ error: 'internal server error' })
}

// ---------------------------------------------------------------------------
// Bootstrap route (top-level GET /api/onboarding/bootstrap — auth only)
// ---------------------------------------------------------------------------

export interface BootstrapWorkspace {
  id: string
  name: string
  role: string
  onboardingStatus: 'not_started' | 'in_progress' | 'completed'
}

export interface BootstrapDeps {
  auth: RequireAuthDeps
  getUserWorkspaces: (accessToken: string) => Promise<BootstrapWorkspace[]>
}

export function bootstrapRouter(deps: BootstrapDeps): Router {
  const router = Router()
  router.get(
    '/api/onboarding/bootstrap',
    requireAuth(deps.auth),
    async (req, res) => {
      try {
        const workspaces = await deps.getUserWorkspaces(req.accessToken ?? '')
        res.json({ workspaces })
      } catch (err) {
        handleError(err, res)
      }
    }
  )
  return router
}

// ---------------------------------------------------------------------------
// Module routes (mounted at /api/m/onboarding by registerModules)
// ---------------------------------------------------------------------------

export interface OnboardingRouterDeps {
  /** Factory that produces a per-request RLS-scoped service (hubStore user-scoped) from the bearer token. */
  makeService: (token: string) => OnboardingService
  auth: RequireAuthDeps
  workspace: RequireWorkspaceDeps
  onboardingStore: OnboardingStore
  createWorkspace: (accessToken: string, name: string) => Promise<{ workspaceId: string }>
}

export function createOnboardingRouter(deps: OnboardingRouterDeps): Router {
  const router = Router()
  const { makeService, auth, workspace, onboardingStore, createWorkspace } = deps

  const authWs = () => authedWorkspaceRoute({ auth, workspace })

  function resolveService(req: import('express').Request): OnboardingService {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    return makeService(token)
  }

  // ----- POST /workspace — requireAuth only, gate-exempt -----
  router.post('/workspace', requireAuth(auth), async (req, res) => {
    const { name } = req.body as { name?: string }
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' })
      return
    }
    try {
      const result = await createWorkspace(req.accessToken ?? '', name.trim())
      // Create an onboarding session for the new workspace
      await onboardingStore.createSession(result.workspaceId, req.user!.id)
      res.status(201).json({ workspaceId: result.workspaceId })
    } catch (err) {
      handleError(err, res)
    }
  })

  // ----- GET /session -----
  router.get('/session', ...authWs(), requireWorkspaceAdmin(), async (req, res) => {
    try {
      const ctx = {
        workspaceId: req.workspaceId!,
        userId: req.user!.id,
        sessionId: '', // will be resolved via load
      }
      // We need session id from the store
      const session = await onboardingStore.getSession(ctx.workspaceId)
      if (!session) {
        res.status(404).json({ error: 'no onboarding session found' })
        return
      }
      const snapshot = await resolveService(req).load({ ...ctx, sessionId: session.id })
      res.json(snapshot)
    } catch (err) {
      handleError(err, res)
    }
  })

  // ----- PUT /profile -----
  router.put('/profile', ...authWs(), requireWorkspaceAdmin(), async (req, res) => {
    try {
      const session = await onboardingStore.getSession(req.workspaceId!)
      if (!session) { res.status(404).json({ error: 'no onboarding session found' }); return }
      const snapshot = await resolveService(req).saveProfile(
        { workspaceId: req.workspaceId!, userId: req.user!.id, sessionId: session.id },
        req.body
      )
      res.json(snapshot)
    } catch (err) {
      handleError(err, res)
    }
  })

  // ----- PUT /rules -----
  router.put('/rules', ...authWs(), requireWorkspaceAdmin(), async (req, res) => {
    try {
      const session = await onboardingStore.getSession(req.workspaceId!)
      if (!session) { res.status(404).json({ error: 'no onboarding session found' }); return }
      const snapshot = await resolveService(req).saveRules(
        { workspaceId: req.workspaceId!, userId: req.user!.id, sessionId: session.id },
        req.body
      )
      res.json(snapshot)
    } catch (err) {
      handleError(err, res)
    }
  })

  // ----- PUT /industry -----
  router.put('/industry', ...authWs(), requireWorkspaceAdmin(), async (req, res) => {
    try {
      const session = await onboardingStore.getSession(req.workspaceId!)
      if (!session) { res.status(404).json({ error: 'no onboarding session found' }); return }
      const snapshot = await resolveService(req).saveIndustry(
        { workspaceId: req.workspaceId!, userId: req.user!.id, sessionId: session.id },
        req.body
      )
      res.json(snapshot)
    } catch (err) {
      handleError(err, res)
    }
  })

  // ----- PUT /people -----
  router.put('/people', ...authWs(), requireWorkspaceAdmin(), async (req, res) => {
    try {
      const session = await onboardingStore.getSession(req.workspaceId!)
      if (!session) { res.status(404).json({ error: 'no onboarding session found' }); return }
      const snapshot = await resolveService(req).savePeople(
        { workspaceId: req.workspaceId!, userId: req.user!.id, sessionId: session.id },
        req.body
      )
      res.json(snapshot)
    } catch (err) {
      handleError(err, res)
    }
  })

  // ----- POST /finish -----
  router.post('/finish', ...authWs(), requireWorkspaceAdmin(), async (req, res) => {
    try {
      const session = await onboardingStore.getSession(req.workspaceId!)
      if (!session) { res.status(404).json({ error: 'no onboarding session found' }); return }
      const result = await resolveService(req).finish(
        { workspaceId: req.workspaceId!, userId: req.user!.id, sessionId: session.id }
      )
      res.json(result)
    } catch (err) {
      handleError(err, res)
    }
  })

  // ----- POST /retry/:id -----
  router.post('/retry/:id', ...authWs(), requireWorkspaceAdmin(), async (req, res) => {
    try {
      const session = await onboardingStore.getSession(req.workspaceId!)
      if (!session) { res.status(404).json({ error: 'no onboarding session found' }); return }
      await resolveService(req).retryInvitation(
        { workspaceId: req.workspaceId!, userId: req.user!.id, sessionId: session.id },
        req.params.id
      )
      res.json({ ok: true })
    } catch (err) {
      handleError(err, res)
    }
  })

  return router
}
