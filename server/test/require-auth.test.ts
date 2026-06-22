import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { requireAuth } from '../src/middleware/require-auth.js'

function appWith(getUser: (t: string) => Promise<{ id: string; email: string | null } | null>) {
  const app = express()
  app.get('/api/me', requireAuth({ getUser }), (req, res) => res.json(req.user))
  return app
}

/** Build a fake JWT-shaped token: h.<base64url(payload)>.<sig> */
function fakeToken(payload: Record<string, unknown>): string {
  const seg = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `h.${seg}.sig`
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

describe('requireAuth — aal claim reading', () => {
  function aalApp() {
    const getUser = async () => ({ id: 'u1', email: 'u@test.dev' })
    const app = express()
    app.get('/api/me', requireAuth({ getUser }), (req, res) => res.json({ aal: req.aal }))
    return app
  }

  it('sets req.aal to "aal2" when token payload contains aal:"aal2"', async () => {
    const token = fakeToken({ sub: 'u1', aal: 'aal2' })
    const res = await request(aalApp()).get('/api/me').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.aal).toBe('aal2')
  })

  it('sets req.aal to "aal1" when token payload contains aal:"aal1"', async () => {
    const token = fakeToken({ sub: 'u1', aal: 'aal1' })
    const res = await request(aalApp()).get('/api/me').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.aal).toBe('aal1')
  })

  it('sets req.aal to null when token payload has no aal claim', async () => {
    const token = fakeToken({ sub: 'u1' })
    const res = await request(aalApp()).get('/api/me').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.aal).toBeNull()
  })
})
