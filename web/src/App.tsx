import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { apiFetch } from './api'
import { Login } from './Login'
import { Shell } from './Shell'
import { Landing } from './marketing/Landing'

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
  const [session, setSession] = useState<Session | null>(null)
  const { route, go } = useHashRoute()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session)).catch(() => {})
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  // Authenticated users always get the app.
  if (session) {
    return (
      <Shell
        fetchMe={() => apiFetch('/api/me', session.access_token)}
        onSignOut={() => supabase.auth.signOut()}
      />
    )
  }

  // Demo route — preview the signed-in experience without a backend.
  if (route.startsWith('/app')) {
    return (
      <Shell
        fetchMe={async () => ({ id: 'demo', email: 'owner@coastlineplumbing.com.au' })}
        onSignOut={() => go('/')}
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
