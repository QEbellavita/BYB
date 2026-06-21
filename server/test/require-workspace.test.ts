import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { requireWorkspace, Membership } from '../src/middleware/require-workspace.js'

function appWith(getMembership: (t: string, ws: string) => Promise<Membership | null>) {
  const app = express()
  app.use((req, _res, next) => { req.user = { id: 'u1', email: null }; req.accessToken = 'tok'; next() })
  app.get('/x', requireWorkspace({ getMembership }), (req, res) =>
    res.json({ workspaceId: req.workspaceId, member: req.member }))
  return app
}

describe('requireWorkspace', () => {
  it('400 without x-workspace-id', async () => {
    const res = await request(appWith(async () => null)).get('/x')
    expect(res.status).toBe(400)
  })

  it('403 when not a member', async () => {
    const res = await request(appWith(async () => null)).get('/x').set('x-workspace-id', 'ws1')
    expect(res.status).toBe(403)
  })

  it('attaches workspaceId and member when a member', async () => {
    const m = { role: 'manager', permissions: { granted: ['x'] } }
    const res = await request(appWith(async () => m)).get('/x').set('x-workspace-id', 'ws1')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ workspaceId: 'ws1', member: m })
  })
})
