import type { ModuleManifest } from '../types.js'
import type { OnboardingRouterDeps } from './routes.js'
import { createOnboardingRouter } from './routes.js'

export function createOnboardingManifest(deps: OnboardingRouterDeps): ModuleManifest {
  return {
    id: 'onboarding',
    name: 'Onboarding',
    dependsOn: [],
    defaultEnabled: true,
    gateExempt: [{ method: 'POST', path: '/workspace' }],
    register(router) {
      const onboardingRouter = createOnboardingRouter(deps)
      router.use(onboardingRouter)
    },
  }
}
