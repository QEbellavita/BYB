import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/App'

// Mock supabase
vi.mock('../../src/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut: vi.fn(),
      signInWithOtp: vi.fn(),
      refreshSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
  },
}))

// Mock mfaApi module
vi.mock('../../src/mfa/mfaApi', () => ({
  getAAL: vi.fn(),
  listFactors: vi.fn(),
  challengeAndVerify: vi.fn(),
  enrollTotp: vi.fn(),
  unenroll: vi.fn(),
}))

const API_URL = 'http://api.test'

const localStorageData: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => localStorageData[key] ?? null,
  setItem: (key: string, value: string) => { localStorageData[key] = value },
  removeItem: (key: string) => { delete localStorageData[key] },
  clear: () => { Object.keys(localStorageData).forEach((k) => delete localStorageData[k]) },
}
vi.stubGlobal('localStorage', localStorageMock)

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', API_URL)
  localStorageMock.clear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function getSupabaseMock() {
  const mod = await import('../../src/supabase')
  return mod.supabase
}

async function getMfaApiMock() {
  return await import('../../src/mfa/mfaApi')
}

// Common fetch mock for an authenticated+completed workspace session
function makeCompletedWorkspaceFetch() {
  return vi.fn(async (url: string) => {
    if (url.includes('/api/onboarding/bootstrap')) {
      return new Response(
        JSON.stringify({
          workspaces: [{ id: 'w1', name: 'Acme', role: 'owner', onboardingStatus: 'completed' }],
        }),
        { status: 200 },
      )
    }
    return new Response(JSON.stringify({ id: 'u1', email: 'a@test.dev' }), { status: 200 })
  })
}

describe('MFA Challenge gate in App', () => {
  it('Test A: renders ChallengeMfa when AAL1 and factors exist', async () => {
    const supabase = await getSupabaseMock()
    const mfaApi = await getMfaApiMock()

    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'tok1', user: { id: 'u1' } } },
      error: null,
    } as never)

    vi.mocked(mfaApi.getAAL).mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal2' },
      error: null,
    } as never)

    vi.mocked(mfaApi.listFactors).mockResolvedValue({
      data: { totp: [{ id: 'factor-1', friendly_name: 'My Auth', status: 'verified' }] },
      error: null,
    } as never)

    vi.stubGlobal('fetch', makeCompletedWorkspaceFetch())
    localStorageMock.setItem('byb.workspaceId', 'w1')
    window.location.hash = '#/'

    render(<App />)

    // Should show ChallengeMfa, not Shell
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /verify/i })).toBeInTheDocument()
    })
    // Shell sign-out button should NOT be present
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument()
  })

  it('Test B: entering code and submitting calls challengeAndVerify and shows Shell on success', async () => {
    const supabase = await getSupabaseMock()
    const mfaApi = await getMfaApiMock()

    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'tok1', user: { id: 'u1' } } },
      error: null,
    } as never)

    // Initially aal1 → challenge needed
    vi.mocked(mfaApi.getAAL)
      .mockResolvedValueOnce({
        data: { currentLevel: 'aal1', nextLevel: 'aal2' },
        error: null,
      } as never)
      // After verify success, re-check returns aal2
      .mockResolvedValue({
        data: { currentLevel: 'aal2', nextLevel: 'aal2' },
        error: null,
      } as never)

    vi.mocked(mfaApi.listFactors).mockResolvedValue({
      data: { totp: [{ id: 'factor-1', friendly_name: 'My Auth', status: 'verified' }] },
      error: null,
    } as never)

    vi.mocked(mfaApi.challengeAndVerify).mockResolvedValue({
      data: { user: {} },
      error: null,
    } as never)

    vi.stubGlobal('fetch', makeCompletedWorkspaceFetch())
    localStorageMock.setItem('byb.workspaceId', 'w1')

    render(<App />)

    // Wait for challenge screen
    const input = await screen.findByRole('textbox')
    await userEvent.type(input, '123456')
    await userEvent.click(screen.getByRole('button', { name: /verify/i }))

    expect(mfaApi.challengeAndVerify).toHaveBeenCalledWith('factor-1', '123456')

    // After success, Shell should render
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
    })
  })

  it('Test C: skips challenge when already aal2 - Shell renders directly', async () => {
    const supabase = await getSupabaseMock()
    const mfaApi = await getMfaApiMock()

    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'tok1', user: { id: 'u1' } } },
      error: null,
    } as never)

    vi.mocked(mfaApi.getAAL).mockResolvedValue({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
      error: null,
    } as never)

    vi.mocked(mfaApi.listFactors).mockResolvedValue({
      data: { totp: [{ id: 'factor-1', friendly_name: 'My Auth', status: 'verified' }] },
      error: null,
    } as never)

    vi.stubGlobal('fetch', makeCompletedWorkspaceFetch())
    localStorageMock.setItem('byb.workspaceId', 'w1')

    render(<App />)

    // Shell should render directly without challenge
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
    })
    // No challenge UI
    expect(screen.queryByRole('button', { name: /verify/i })).not.toBeInTheDocument()
  })

  it('Test D: skips challenge when aal1 and nextLevel is aal1 (no factor enrolled)', async () => {
    const supabase = await getSupabaseMock()
    const mfaApi = await getMfaApiMock()

    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'tok1', user: { id: 'u1' } } },
      error: null,
    } as never)

    vi.mocked(mfaApi.getAAL).mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal1' },
      error: null,
    } as never)

    vi.mocked(mfaApi.listFactors).mockResolvedValue({
      data: { totp: [] },
      error: null,
    } as never)

    vi.stubGlobal('fetch', makeCompletedWorkspaceFetch())
    localStorageMock.setItem('byb.workspaceId', 'w1')

    render(<App />)

    // Shell renders directly, no challenge
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /verify/i })).not.toBeInTheDocument()
  })
})
