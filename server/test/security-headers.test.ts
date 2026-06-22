import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'

beforeEach(() => { delete process.env.NODE_ENV })
afterEach(() => { delete process.env.NODE_ENV })

describe('security headers', () => {
  it('sets baseline security headers and hides x-powered-by', async () => {
    const res = await request(createApp()).get('/health')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'")
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
  it('sets HSTS only in production', async () => {
    const dev = await request(createApp()).get('/health')
    expect(dev.headers['strict-transport-security']).toBeUndefined()
    process.env.NODE_ENV = 'production'
    const prod = await request(createApp()).get('/health')
    expect(prod.headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains; preload')
  })
})
