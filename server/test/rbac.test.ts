import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { resolvePermissions } from '../src/auth/rbac.js'
import { requirePermission } from '../src/middleware/require-permission.js'

describe('resolvePermissions', () => {
  it('grants wildcard to owner', () => {
    expect(resolvePermissions({ role: 'owner', permissions: {} }).has('*')).toBe(true)
  })
  it('grants wildcard to admin', () => {
    expect(resolvePermissions({ role: 'admin', permissions: {} }).has('*')).toBe(true)
  })
  it('applies role defaults for compliance_officer', () => {
    const p = resolvePermissions({ role: 'compliance_officer', permissions: {} })
    expect(p.has('obligations.write')).toBe(true)
  })
  it('honors per-member grants and revokes', () => {
    const p = resolvePermissions({ role: 'staff', permissions: { granted: ['risk.write'], revoked: ['risk.read'] } })
    expect(p.has('risk.write')).toBe(true)
    expect(p.has('risk.read')).toBe(false)
  })
})

describe('requirePermission', () => {
  function appWith(member: any) {
    const app = express()
    app.use((req, _res, next) => { req.member = member; next() })
    app.get('/x', requirePermission('risk.write'), (_req, res) => res.json({ ok: true }))
    return app
  }
  function appWithNoMember() {
    const app = express()
    app.get('/x', requirePermission('risk.write'), (_req, res) => res.json({ ok: true }))
    return app
  }
  it('403 when req.member is absent', async () => {
    const res = await request(appWithNoMember()).get('/x')
    expect(res.status).toBe(403)
  })
  it('403 when missing the permission', async () => {
    const res = await request(appWith({ role: 'staff', permissions: {} })).get('/x')
    expect(res.status).toBe(403)
  })
  it('200 with the permission', async () => {
    const res = await request(appWith({ role: 'staff', permissions: { granted: ['risk.write'] } })).get('/x')
    expect(res.status).toBe(200)
  })
  it('200 for owner via wildcard', async () => {
    const res = await request(appWith({ role: 'owner', permissions: {} })).get('/x')
    expect(res.status).toBe(200)
  })
})
