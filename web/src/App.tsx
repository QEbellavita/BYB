import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { apiFetch } from './api'
import { onboardingApi } from './onboarding/api'
import type { OnboardingSnapshot, WorkspaceInfo } from './onboarding/types'
import { OnboardingWizard } from './onboarding/OnboardingWizard'
import { Login } from './Login'
import { Shell } from './Shell'
import { Landing } from './marketing/Landing'

type AppState = 'auth-loading' | 'signed-out' | 'onboarding' | 'ready'

const WORKSPACE_KEY = 'byb.workspaceId'

/** Minimal hash router — no dependency. Routes: #/ , #/signin , #/app (demo). */
function useHashRoute() {
  const get = () => (typeof window === 'undefined' ? '/' : window.location.hash.replace(/^#/, '') || '/')
  const [route, setRoute] = useState(get)
  useEffect(() => {
    const onHash = () => setRoute(get())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const go = (to: string) => { window.location.hash = to }
  return { route, go }
}

export function App() {
  const [appState, setAppState] = useState<AppState>('auth-loading')
  const [session, setSession] = useState<Session | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    () => localStorage.getItem(WORKSPACE_KEY),
  )
  const [snapshot, setSnapshot] = useState<OnboardingSnapshot | null>(null)
  const { route, go } = useHashRoute()

  // Resolve the onboarding gate once auth is known (authenticated users only).
  const resolveGate = useCallback(
    async (sess: Session, wsId: string | null) => {
      const api = onboardingApi(sess.access_token, wsId ?? undefined)

      const bootstrap = await api.bootstrap()
      const workspaces: WorkspaceInfo[] = bootstrap.workspaces

      let chosenId = wsId
      if (!chosenId && workspaces.length > 0) {
        chosenId = workspaces[0].id
        localStorage.setItem(WORKSPACE_KEY, chosenId)
        setWorkspaceId(chosenId)
      }

      if (!chosenId) {
        // No workspace yet — onboarding creates the first one.
        setSnapshot(null)
        setAppState('onboarding')
        return
      }

      const ws = workspaces.find((w) => w.id === chosenId)
      if (ws?.onboardingStatus === 'completed') {
        setAppState('ready')
        return
      }

      const loadApi = onboardingApi(sess.access_token, chosenId)
      const snap = await loadApi.load()
      setSnapshot(snap)
      setAppState('onboarding')
    },
    [],
  )

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      const sess = data.session
      setSession(sess)
      if (!sess) {
        setAppState('signed-out')
      } else {
        const wsId = localStorage.getItem(WORKSPACE_KEY)
        resolveGate(sess, wsId).catch(() => {
          if (!cancelled) setAppState('onboarding')
        })
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => {
      if (cancelled) return
      setSession(sess)
      if (!sess) {
        setAppState('signed-out')
        setSnapshot(null)
      } else {
        const wsId = localStorage.getItem(WORKSPACE_KEY)
        resolveGate(sess, wsId).catch(() => {
          if (!cancelled) setAppState('onboarding')
        })
      }
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [resolveGate])

  const handleWorkspaceCreated = useCallback((id: string) => {
    localStorage.setItem(WORKSPACE_KEY, id)
    setWorkspaceId(id)
    if (session) {
      resolveGate(session, id).catch(() => setAppState('onboarding'))
    }
  }, [session, resolveGate])

  const handleComplete = useCallback(() => {
    setAppState('ready')
  }, [])

  // Initial auth check — brief, before we know whether anyone is signed in.
  if (appState === 'auth-loading') {
    return <p>Loading BtG</p>
  }

  // Signed-out: the marketing site + demo preview (no backend needed).
  if (appState === 'signed-out' || !session) {
    if (route.startsWith('/app')) {
      return (
        <Shell
          fetchMe={async () => ({ id: 'demo', email: 'owner@coastlineplumbing.com.au' })}
          onSignOut={() => go('/')}
          token=""
          workspaceId=""
        />
      )
    }
    if (route.startsWith('/signin')) {
      return (
        <Login
          signInWithOtp={(email) => supabase.auth.signInWithOtp({ email })}
          onBack={() => go('/')}
        />
      )
    }
    return <Landing onStart={() => go('/signin')} onSignIn={() => go('/signin')} />
  }

  // Authenticated but onboarding not complete — run the wizard.
  if (appState === 'onboarding') {
    return (
      <OnboardingWizard
        token={session.access_token}
        workspaceId={workspaceId}
        snapshot={snapshot}
        onWorkspaceCreated={handleWorkspaceCreated}
        onComplete={handleComplete}
      />
    )
  }

  // Ready — the real app.
  return (
    <Shell
      fetchMe={() => apiFetch('/api/me', session.access_token)}
      onSignOut={() => supabase.auth.signOut()}
      token={session.access_token}
      workspaceId={workspaceId ?? ''}
    />
  )
}
