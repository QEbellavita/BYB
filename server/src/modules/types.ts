import type { Router } from 'express'

export interface ModuleManifest {
  id: string
  name: string
  dependsOn: string[]
  defaultEnabled: boolean
  register(router: Router): void
}
