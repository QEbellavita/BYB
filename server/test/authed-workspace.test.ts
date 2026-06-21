import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { authedWorkspaceRoute } from '../src/middleware/authed-workspace.js'
import { requireWorkspace } from '../src/middleware/require-workspace.js'

describe('authedWorkspaceRoute', () => {
  it('returns [requireAuth, requireWorkspace] in order', () => {
    const handlers = authedWorkspaceRoute({
      auth: { getUser: async () => null },
      workspace: { getMembership: async () => null },
    })
    expect(handlers).toHaveLength(2)
    expect(typeof handlers[0]).toBe('function')
    expect(typeof handlers[1]).toBe('function')
  })
})

describe('requireWorkspace fail-loud guard', () => {
  it('500s when req.user/accessToken is missing (auth did not run)', async () => {
    const app = express()
    // NOTE: no auth middleware sets req.user — simulates a wiring bug
    app.get('/x', requireWorkspace({ getMembership: async () => ({ role: 'staff', permissions: {} }) }),
      (_req, res) => res.json({ ok: true }))
    const res = await request(app).get('/x').set('x-workspace-id', 'ws1')
    expect(res.status).toBe(500)
  })
})
