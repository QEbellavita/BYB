import type { ModuleManifest } from '../types.js'
import type { RiskRouterDeps } from './routes.js'
import { createRiskRouter } from './routes.js'

export function createRiskManifest(deps: RiskRouterDeps): ModuleManifest {
  return {
    id: 'risk',
    name: 'Risk Register',
    dependsOn: [],
    defaultEnabled: true,
    register(router) {
      router.use(createRiskRouter(deps))
    },
  }
}
