import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'

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
})
