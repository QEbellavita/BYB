import { describe, it, expect, vi } from 'vitest'
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
  function appWith(enabled: boolean | null) {
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
  it('200s when no feature row (null) and manifest.defaultEnabled is true', async () => {
    // mod() creates manifests with defaultEnabled:true; null = no row → falls back to defaultEnabled
    const res = await request(appWith(null)).get('/api/m/risk/ping')
    expect(res.status).toBe(200)
  })
  it('404s when no feature row (null) and manifest.defaultEnabled is false', async () => {
    const app = express()
    app.use((req, _res, next) => { req.workspaceId = 'ws1'; next() })
    const disabledByDefault: ModuleManifest = {
      id: 'beta', name: 'beta', dependsOn: [], defaultEnabled: false,
      register(r: Router) { r.get('/ping', (_req, res) => res.json({ id: 'beta' })) },
    }
    registerModules(app, [disabledByDefault], { isEnabled: async () => null })
    const res = await request(app).get('/api/m/beta/ping')
    expect(res.status).toBe(404)
  })
  it('404s when explicit row is enabled:false even if defaultEnabled is true', async () => {
    // mod() has defaultEnabled:true, but explicit row says false
    const res = await request(appWith(false)).get('/api/m/risk/ping')
    expect(res.status).toBe(404)
  })
})

describe('registerModules gateExempt', () => {
  function modWithExempt(id: string, exemptPath: string): ModuleManifest {
    return {
      id, name: id, dependsOn: [], defaultEnabled: true,
      gateExempt: [{ method: 'POST', path: exemptPath }],
      register(r: Router) {
        r.post('/workspace', (_req, res) => res.status(201).json({ ok: true }))
        r.get('/session', (_req, res) => res.json({ ok: true }))
      },
    }
  }

  it('bypasses the feature gate for an exact method+path match', async () => {
    const app = express()
    // No workspaceId set — gate would block without exemption
    registerModules(app, [modWithExempt('onboarding', '/workspace')], {
      isEnabled: async () => false,
    })
    // POST /workspace is exempt — should NOT get 404
    const res = await request(app).post('/api/m/onboarding/workspace')
    expect(res.status).toBe(201)
  })

  it('still gates non-exempt paths even when gateExempt is defined', async () => {
    const app = express()
    app.use((req, _res, next) => { req.workspaceId = 'ws1'; next() })
    registerModules(app, [modWithExempt('onboarding', '/workspace')], {
      isEnabled: async () => false,
    })
    // GET /session is NOT exempt — should get 404
    const res = await request(app).get('/api/m/onboarding/session')
    expect(res.status).toBe(404)
  })

  it('passes accessToken to isEnabled', async () => {
    const isEnabled = vi.fn().mockResolvedValue(true)
    const app = express()
    app.use((req, _res, next) => { req.workspaceId = 'ws1'; next() })
    registerModules(app, [mod('risk')], { isEnabled })
    await request(app).get('/api/m/risk/ping').set('authorization', 'Bearer my-token')
    expect(isEnabled).toHaveBeenCalledWith('ws1', 'risk', 'my-token')
  })

  it('reads workspace id from x-workspace-id header when req.workspaceId is not set', async () => {
    const isEnabled = vi.fn().mockResolvedValue(true)
    const app = express()
    // no middleware sets req.workspaceId
    registerModules(app, [mod('risk')], { isEnabled })
    await request(app).get('/api/m/risk/ping').set('x-workspace-id', 'ws-from-header')
    expect(isEnabled).toHaveBeenCalledWith('ws-from-header', 'risk', '')
  })
})
