import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import { createApp } from '../src/app.js'
import { corsMiddleware } from '../src/middleware/cors.js'

function makeApp(originSpec?: string) {
  const app = express()
  app.use(corsMiddleware(originSpec))
  app.get('/t', (_req, res) => res.json({ ok: true }))
  return app
}

describe('CORS', () => {
  it('answers preflight OPTIONS with 204 and the allowed headers', async () => {
    const res = await request(createApp()).options('/health')
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(res.headers['access-control-allow-methods']).toContain('POST')
    expect(res.headers['access-control-allow-headers']).toContain('Authorization')
    expect(res.headers['access-control-allow-headers']).toContain('x-workspace-id')
  })

  it('sets the allow-origin header on normal responses', async () => {
    const res = await request(createApp()).get('/health')
    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })

  // Allowlist tests
  it('echoes an allow-listed origin and sets Vary', async () => {
    const app = makeApp('https://a.example.com,https://b.example.com')
    const res = await request(app).get('/t').set('Origin', 'https://b.example.com')
    expect(res.headers['access-control-allow-origin']).toBe('https://b.example.com')
    expect(res.headers['vary']).toMatch(/Origin/)
  })

  it('omits ACAO for a non-allow-listed origin', async () => {
    const app = makeApp('https://a.example.com')
    const res = await request(app).get('/t').set('Origin', 'https://evil.example.com')
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('still answers OPTIONS preflight with 204', async () => {
    const app = makeApp('https://a.example.com')
    const res = await request(app).options('/t').set('Origin', 'https://a.example.com')
    expect(res.status).toBe(204)
  })

  it('warns when CORS_ORIGIN is "*" in production', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try { corsMiddleware('*'); expect(warn).toHaveBeenCalled() }
    finally { process.env.NODE_ENV = prev; warn.mockRestore() }
  })

  it('does not warn with an explicit allowlist in production', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try { corsMiddleware('https://a.example.com'); expect(warn).not.toHaveBeenCalled() }
    finally { process.env.NODE_ENV = prev; warn.mockRestore() }
  })
})
