import { describe, it, expect } from 'vitest'
import express, { Router } from 'express'
import request from 'supertest'
import { orderModules, registerModules } from '../src/modules/loader.js'
import type { ModuleManifest } from '../src/modules/types.js'

function mod(id: string, dependsOn: string[] = []): ModuleManifest {
  return {
    id, name: id, dependsOn, defaultEnabled: true,
    register(r: Router) { r.get('/ping', (_req, res) => res.json({ id })) },
  }
}

describe('orderModules', () => {
  it('orders dependencies before dependents', () => {
    const ordered = orderModules([mod('b', ['a']), mod('a')]).map(m => m.id)
    expect(ordered.indexOf('a')).toBeLessThan(ordered.indexOf('b'))
  })
  it('throws on a missing dependency', () => {
    expect(() => orderModules([mod('b', ['missing'])])).toThrow(/missing/)
  })
  it('throws on a cycle', () => {
    expect(() => orderModules([mod('a', ['b']), mod('b', ['a'])])).toThrow(/cycle/i)
  })
})

describe('registerModules gating', () => {
  function appWith(enabled: boolean) {
    const app = express()
    app.use((req, _res, next) => { req.workspaceId = 'ws1'; next() })
    registerModules(app, [mod('risk')], { isEnabled: async () => enabled })
    return app
  }
  it('404s when the module is disabled', async () => {
    const res = await request(appWith(false)).get('/api/m/risk/ping')
    expect(res.status).toBe(404)
  })
  it('200s when the module is enabled', async () => {
    const res = await request(appWith(true)).get('/api/m/risk/ping')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 'risk' })
  })
})
