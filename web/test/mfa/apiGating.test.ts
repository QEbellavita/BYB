import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiFetch, MfaRequiredError, ApiError } from '../../src/api'

const API_URL = 'http://api.test'

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', API_URL)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('apiFetch MFA gating', () => {
  it('Test E: throws MfaRequiredError when 403 with code mfa_required', async () => {
    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ code: 'mfa_required' }), { status: 403 })
    )
    vi.stubGlobal('fetch', mockFetch)

    let thrown: unknown
    try {
      await apiFetch('/api/protected', 'token')
    } catch (e) {
      thrown = e
    }

    expect(thrown).toBeInstanceOf(MfaRequiredError)
  })

  it('Test F: throws plain ApiError for non-mfa_required 403', async () => {
    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 })
    )
    vi.stubGlobal('fetch', mockFetch)

    let thrown: unknown
    try {
      await apiFetch('/api/protected', 'token')
    } catch (e) {
      thrown = e
    }

    expect(thrown).toBeInstanceOf(ApiError)
    expect(thrown).not.toBeInstanceOf(MfaRequiredError)
    expect((thrown as ApiError).status).toBe(403)
  })
})
