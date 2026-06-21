import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { apiFetch } from './api'
import { Login } from './Login'
import { Shell } from './Shell'

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!session) {
    return <Login signInWithOtp={(email) => supabase.auth.signInWithOtp({ email })} />
  }
  return (
    <Shell
      fetchMe={() => apiFetch('/api/me', session.access_token)}
      onSignOut={() => supabase.auth.signOut()}
    />
  )
}
