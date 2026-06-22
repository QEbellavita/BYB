import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { riskApi } from '../../src/app/risk-api'
import { complaintsApi } from '../../src/app/complaints-api'
import { improvementsApi } from '../../src/app/improvements-api'

// Drives the REAL *-api.ts clients through a mocked fetch, so the web<->server
// envelope contract is exercised (the injected-fake page tests never hit apiFetch).

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'http://api.test')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function mockFetch(body: unknown) {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('module api list() unwraps the server envelope', () => {
  it('riskApi.list returns the bare array from { risks }', async () => {
    const fetchFn = mockFetch({ risks: [{ id: 'r1', title: 'x', likelihood: 2, impact: 3 }] })
    const result = await riskApi('tok', 'ws1').list()
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('r1')
    expect(fetchFn.mock.calls[0][0]).toBe('http://api.test/api/m/risk/risks')
  })

  it('complaintsApi.list returns the bare array from { complaints }', async () => {
    mockFetch({ complaints: [{ id: 'c1', reference: 'C-001', status: 'new' }] })
    const result = await complaintsApi('tok', 'ws1').list()
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('c1')
  })

  it('improvementsApi.list returns the bare array from { improvements }', async () => {
    mockFetch({ improvements: [{ id: 'i1', source: 'manual', title: 't', status: 'open' }] })
    const result = await improvementsApi('tok', 'ws1').list()
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('i1')
  })

  it('riskApi.create sends camelCase optional fields the server validation reads', async () => {
    const fetchFn = mockFetch({ id: 'r2', title: 'x', likelihood: 1, impact: 1 })
    await riskApi('tok', 'ws1').create({
      title: 'x', likelihood: 1, impact: 1, ownerPersonId: 'p1', reviewDate: '2026-01-01', frameworkId: 'f1',
    })
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toMatchObject({ ownerPersonId: 'p1', reviewDate: '2026-01-01', frameworkId: 'f1' })
  })
})
