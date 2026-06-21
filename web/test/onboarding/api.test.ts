import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiFetch, ApiError } from '../../src/api'

const API_URL = 'http://api.test'

describe('apiFetch', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', API_URL)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('sends Authorization header', async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', mockFetch)

    await apiFetch('/api/me', 'my-token')

    expect(mockFetch).toHaveBeenCalledWith(
      `${API_URL}/api/me`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer my-token' }),
      }),
    )
  })

  it('sends x-workspace-id header when workspaceId is supplied', async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))
    vi.stubGlobal('fetch', mockFetch)

    await apiFetch('/api/m/onboarding/session', 'token', { workspaceId: 'w1' })

    expect(mockFetch).toHaveBeenCalledWith(
      `${API_URL}/api/m/onboarding/session`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
          'x-workspace-id': 'w1',
        }),
      }),
    )
  })

  it('does NOT send x-workspace-id when workspaceId is absent', async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))
    vi.stubGlobal('fetch', mockFetch)

    await apiFetch('/api/me', 'token')

    const [, init] = (mockFetch.mock.calls[0] as unknown) as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['x-workspace-id']).toBeUndefined()
  })

  it('sends Content-Type and JSON body when body is present', async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))
    vi.stubGlobal('fetch', mockFetch)

    await apiFetch('/api/m/onboarding/profile', 'token', {
      method: 'PUT',
      workspaceId: 'w1',
      body: { name: 'Acme' },
    })

    expect(mockFetch).toHaveBeenCalledWith(
      `${API_URL}/api/m/onboarding/profile`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ name: 'Acme' }),
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      }),
    )
  })

  it('does NOT send Content-Type when no body', async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))
    vi.stubGlobal('fetch', mockFetch)

    await apiFetch('/api/me', 'token')

    const [, init] = (mockFetch.mock.calls[0] as unknown) as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBeUndefined()
  })

  it('throws ApiError with status and body on non-ok response', async () => {
    const errorBody = { message: 'Not found' }
    const mockFetch = vi.fn(async () => new Response(JSON.stringify(errorBody), { status: 404 }))
    vi.stubGlobal('fetch', mockFetch)

    const err: unknown = await apiFetch('/api/me', 'token').catch((e) => e)

    expect(err).toBeInstanceOf(ApiError)
    const apiErr = err as ApiError
    expect(apiErr.status).toBe(404)
    expect(apiErr.body).toEqual(errorBody)
  })
})

describe('onboardingApi shape', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', API_URL)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('load() sends GET /api/m/onboarding/session with x-workspace-id', async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ current_step: 'profile' }), { status: 200 }))
    vi.stubGlobal('fetch', mockFetch)

    const { onboardingApi } = await import('../../src/onboarding/api')
    const api = onboardingApi('token', 'w1')
    await api.load()

    expect(mockFetch).toHaveBeenCalledWith(
      `${API_URL}/api/m/onboarding/session`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
          'x-workspace-id': 'w1',
        }),
      }),
    )
  })

  it('bootstrap() calls /api/onboarding/bootstrap without workspaceId', async () => {
    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ workspaces: [] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', mockFetch)

    const { onboardingApi } = await import('../../src/onboarding/api')
    const api = onboardingApi('token')
    await api.bootstrap()

    expect(mockFetch).toHaveBeenCalledWith(
      `${API_URL}/api/onboarding/bootstrap`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }),
    )
    const [, init] = (mockFetch.mock.calls[0] as unknown) as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['x-workspace-id']).toBeUndefined()
  })

  it('createWorkspace() POSTs with JSON body', async () => {
    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'w2', name: 'Acme' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', mockFetch)

    const { onboardingApi } = await import('../../src/onboarding/api')
    const api = onboardingApi('token')
    await api.createWorkspace('Acme')

    expect(mockFetch).toHaveBeenCalledWith(
      `${API_URL}/api/m/onboarding/workspace`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Acme' }),
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    )
  })
})
