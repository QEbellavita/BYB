import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadConfig } from '../src/config.js'

const BASE = {
  SUPABASE_URL: 'http://localhost',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
}

describe('loadConfig email block', () => {
  let saved: NodeJS.ProcessEnv
  beforeEach(() => {
    saved = { ...process.env }
    delete process.env.EMAIL_PROVIDER
    delete process.env.RESEND_API_KEY
    delete process.env.EMAIL_FROM
    delete process.env.EMAIL_TIMEOUT_MS
    delete process.env.NODE_ENV
    Object.assign(process.env, BASE)
  })
  afterEach(() => { process.env = saved })

  it('defaults to the console provider with a 10s timeout', () => {
    const cfg = loadConfig()
    expect(cfg.email.provider).toBe('console')
    expect(cfg.email.timeoutMs).toBe(10000)
  })

  it('parses a valid resend config', () => {
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 'rk_live'
    process.env.EMAIL_FROM = 'BYB <no@b.dev>'
    process.env.EMAIL_TIMEOUT_MS = '5000'
    const cfg = loadConfig()
    expect(cfg.email).toEqual({
      provider: 'resend', resendApiKey: 'rk_live', from: 'BYB <no@b.dev>', timeoutMs: 5000,
    })
  })

  it('throws when provider=resend but RESEND_API_KEY is missing', () => {
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.EMAIL_FROM = 'BYB <no@b.dev>'
    expect(() => loadConfig()).toThrow(/RESEND_API_KEY/)
  })

  it('throws when provider=resend but EMAIL_FROM is missing', () => {
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 'rk_live'
    expect(() => loadConfig()).toThrow(/EMAIL_FROM/)
  })

  it('throws on an unknown provider', () => {
    process.env.EMAIL_PROVIDER = 'sendgrid'
    expect(() => loadConfig()).toThrow(/EMAIL_PROVIDER/)
  })

  it('throws on a non-numeric EMAIL_TIMEOUT_MS', () => {
    process.env.EMAIL_TIMEOUT_MS = 'abc'
    expect(() => loadConfig()).toThrow(/EMAIL_TIMEOUT_MS/)
  })

  it('warns (not throws) when production is left on the console provider', () => {
    process.env.NODE_ENV = 'production'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cfg = loadConfig()
    expect(cfg.email.provider).toBe('console')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[email]'))
    warn.mockRestore()
  })
})
