import type { ModuleManifest } from '../types.js'
import type { ComplaintsRouterDeps } from './routes.js'
import { createComplaintsRouter } from './routes.js'

export function createComplaintsManifest(deps: ComplaintsRouterDeps): ModuleManifest {
  return {
    id: 'complaints',
    name: 'Complaints',
    dependsOn: [],
    defaultEnabled: true,
    register(router) {
      router.use(createComplaintsRouter(deps))
    },
  }
}

