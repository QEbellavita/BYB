import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { App } from '../../src/App'

// Mock supabase module
vi.mock('../../src/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut: vi.fn(),
      signInWithOtp: vi.fn(),
    },
  },
}))

const API_URL = 'http://api.test'

// Mock localStorage since jsdom doesn't forward it in this vitest setup
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

describe('App gate', () => {
  it('renders "Loading BtG" while session is loading', async () => {
    const supabase = await getSupabaseMock()
    // getSession never resolves immediately — simulate pending
    vi.mocked(supabase.auth.getSession).mockReturnValue(new Promise(() => {}))

    render(<App />)

    expect(screen.getByText(/loading btg/i)).toBeInTheDocument()
  })

  it('renders the marketing landing when signed out (default route)', async () => {
    const supabase = await getSupabaseMock()
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    } as never)
    window.location.hash = '#/'

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/context-driven operating system/i)).toBeInTheDocument()
    })
  })

  it('renders Login at #/signin when signed out', async () => {
    const supabase = await getSupabaseMock()
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    } as never)
    window.location.hash = '#/signin'

    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /send code/i })).toBeInTheDocument()
    })
    window.location.hash = '#/'
  })

  it('renders onboarding when authed but no workspace', async () => {
    const supabase = await getSupabaseMock()
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'tok1', user: { id: 'u1' } } },
      error: null,
    } as never)

    // bootstrap returns empty workspaces
    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('/api/onboarding/bootstrap')) {
        return new Response(JSON.stringify({ workspaces: [] }), { status: 200 })
      }
      return new Response(JSON.stringify({ id: 'u1', email: 'a@test.dev' }), { status: 200 })
    })
    vi.stubGlobal('fetch', mockFetch)

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-wizard')).toBeInTheDocument()
    })
  })

  it('renders onboarding with current_step when session is incomplete', async () => {
    const supabase = await getSupabaseMock()
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'tok1', user: { id: 'u1' } } },
      error: null,
    } as never)

    // bootstrap returns a workspace with in_progress status
    // session load returns current_step = 'rules'
    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('/api/onboarding/bootstrap')) {
        return new Response(
          JSON.stringify({
            workspaces: [{ id: 'w1', name: 'Acme', role: 'owner', onboardingStatus: 'in_progress' }],
          }),
          { status: 200 },
        )
      }
      if (url.includes('/api/m/onboarding/session')) {
        return new Response(
          JSON.stringify({
            session: { id: 's1', workspace_id: 'w1', user_id: 'u1', current_step: 'rules', completed_steps: ['profile'], created_at: '', updated_at: '' },
            profile: null,
            rules: [],
            obligations: [],
            people: [],
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ id: 'u1', email: 'a@test.dev' }), { status: 200 })
    })
    vi.stubGlobal('fetch', mockFetch)
    localStorageMock.setItem('byb.workspaceId', 'w1')

    render(<App />)

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-wizard')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: /how does your business operate/i })).toBeInTheDocument()
    })
  })

  it('renders Shell when session is completed', async () => {
    const supabase = await getSupabaseMock()
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'tok1', user: { id: 'u1' } } },
      error: null,
    } as never)

    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('/api/onboarding/bootstrap')) {
        return new Response(
          JSON.stringify({
            workspaces: [{ id: 'w1', name: 'Acme', role: 'owner', onboardingStatus: 'completed' }],
          }),
          { status: 200 },
        )
      }
      if (url.includes('/api/m/onboarding/session')) {
        return new Response(
          JSON.stringify({
            session: { id: 's1', workspace_id: 'w1', user_id: 'u1', current_step: 'review', completed_steps: ['profile', 'rules', 'industry', 'people'], created_at: '', updated_at: '' },
            profile: null,
            rules: [],
            obligations: [],
            people: [],
          }),
          { status: 200 },
        )
      }
      // /api/me
      return new Response(JSON.stringify({ id: 'u1', email: 'a@test.dev' }), { status: 200 })
    })
    vi.stubGlobal('fetch', mockFetch)
    localStorageMock.setItem('byb.workspaceId', 'w1')

    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
      expect(screen.getByText('a@test.dev')).toBeInTheDocument()
    })
  })
})
