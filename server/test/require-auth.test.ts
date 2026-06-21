import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { requireAuth } from '../src/middleware/require-auth.js'

function appWith(getUser: (t: string) => Promise<{ id: string; email: string | null } | null>) {
  const app = express()
  app.get('/api/me', requireAuth({ getUser }), (req, res) => res.json(req.user))
  return app
}

describe('requireAuth', () => {
  it('401s without a bearer token', async () => {
    const res = await request(appWith(async () => null)).get('/api/me')
    expect(res.status).toBe(401)
  })

  it('401s when token is invalid', async () => {
    const res = await request(appWith(async () => null))
      .get('/api/me').set('Authorization', 'Bearer bad')
    expect(res.status).toBe(401)
  })

  it('sets req.user for a valid token', async () => {
    const app = appWith(async () => ({ id: 'u1', email: 'u@test.dev' }))
    const res = await request(app).get('/api/me').set('Authorization', 'Bearer good')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 'u1', email: 'u@test.dev' })
  })
})
