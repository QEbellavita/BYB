import { Router } from 'express'
import type { Express } from 'express'
import type { ModuleManifest } from './types.js'

export function orderModules(manifests: ModuleManifest[]): ModuleManifest[] {
  const byId = new Map(manifests.map((m) => [m.id, m]))
  for (const m of manifests) {
    for (const dep of m.dependsOn) {
      if (!byId.has(dep)) throw new Error(`module "${m.id}" depends on missing module "${dep}"`)
    }
  }
  const ordered: ModuleManifest[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (m: ModuleManifest) => {
    const s = state.get(m.id)
    if (s === 'done') return
    if (s === 'visiting') throw new Error(`dependency cycle involving "${m.id}"`)
    state.set(m.id, 'visiting')
    for (const dep of m.dependsOn) visit(byId.get(dep)!)
    state.set(m.id, 'done')
    ordered.push(m)
  }
  for (const m of manifests) visit(m)
  return ordered
}

// NOTE: registerModules is exercised by loader.test.ts (inline manifests) and
// wired into app.ts in SP-1+ when the first real feature module exists.

export interface RegisterDeps {
  isEnabled: (workspaceId: string, moduleId: string, accessToken: string) => Promise<boolean>
}

export function registerModules(app: Express, manifests: ModuleManifest[], deps: RegisterDeps): void {
  for (const m of orderModules(manifests)) {
    const router = Router()
    // gate: a disabled module is invisible (404) for this workspace
    // unless the request matches one of the module's gateExempt entries (exact method+path)
    router.use(async (req, res, next) => {
      // Check if this request is exempt from the feature gate
      const exempt = m.gateExempt?.some(
        (e) =>
          e.method.toUpperCase() === req.method.toUpperCase() &&
          req.path === e.path
      ) ?? false

      if (exempt) return next()

      const wsId = req.workspaceId ?? req.header('x-workspace-id') ?? ''
      const authHeader = req.header('authorization') ?? ''
      const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

      if (!wsId || !(await deps.isEnabled(wsId, m.id, accessToken))) {
        return res.status(404).json({ error: 'module not enabled' })
      }
      next()
    })
    m.register(router)
    app.use(`/api/m/${m.id}`, router)
  }
}
