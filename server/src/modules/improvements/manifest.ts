import type { ModuleManifest } from '../types.js'
import type { ImprovementsRouterDeps } from './routes.js'
import { createImprovementsRouter } from './routes.js'

export function createImprovementsManifest(deps: ImprovementsRouterDeps): ModuleManifest {
  return {
    id: 'improvements',
    name: 'Improvements',
    dependsOn: [],
    defaultEnabled: true,
    register(router) {
      router.use(createImprovementsRouter(deps))
    },
  }
}
