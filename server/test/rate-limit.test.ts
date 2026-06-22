import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { apiRateLimiter, strictRateLimiter } from '../src/middleware/rate-limit.js'

function appWith(limit: number) {
  const app = express()
  app.use(apiRateLimiter({ windowMs: 60_000, limit }))
  app.get('/t', (_req, res) => res.json({ ok: true }))
  return app
}

function strictAppWith(limit: number) {
  const app = express()
  app.use(strictRateLimiter({ windowMs: 60_000, limit }))
  app.get('/t', (_req, res) => res.json({ ok: true }))
  return app
}

describe('apiRateLimiter', () => {
  it('returns 429 after the limit is exceeded', async () => {
    const app = appWith(2)
    expect((await request(app).get('/t')).status).toBe(200)
    expect((await request(app).get('/t')).status).toBe(200)
    const third = await request(app).get('/t')
    expect(third.status).toBe(429)
    expect(third.headers['retry-after']).toBeDefined()
  })
})

describe('strictRateLimiter', () => {
  it('trips on the 2nd request when limit is 1', async () => {
    const app = strictAppWith(1)
    expect((await request(app).get('/t')).status).toBe(200)
    const second = await request(app).get('/t')
    expect(second.status).toBe(429)
    expect(second.headers['retry-after']).toBeDefined()
  })
})
