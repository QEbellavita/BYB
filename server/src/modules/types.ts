import type { Router } from 'express'

export interface ModuleManifest {
  id: string
  name: string
  dependsOn: string[]
  defaultEnabled: boolean
  gateExempt?: { method: string; path: string }[]
  register(router: Router): void
}
