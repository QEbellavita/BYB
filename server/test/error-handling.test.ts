import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'

describe('request hardening', () => {
  afterEach(() => { delete process.env.BODY_LIMIT })

  it('rejects malformed JSON with 400 (not 500)', async () => {
    const res = await request(createApp())
      .post('/api/me').set('Content-Type', 'application/json').send('{bad json')
    expect(res.status).toBe(400)
  })
  it('rejects an oversized body with 413', async () => {
    process.env.BODY_LIMIT = '1kb'
    const big = JSON.stringify({ x: 'a'.repeat(5000) })
    const res = await request(createApp())
      .post('/api/me').set('Content-Type', 'application/json').send(big)
    expect(res.status).toBe(413)
  })
})
