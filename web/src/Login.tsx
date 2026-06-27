import { useState } from 'react'
import { HubSchematic } from './components/HubSchematic'
import './Login.css'

export function Login({
  signInWithOtp,
  signInWithPassword,
  signInAsAdmin,
  onBack,
}: {
  signInWithOtp: (email: string) => Promise<{ error: unknown }>
  /** Optional email+password sign-in (e.g. for admin/tester accounts). */
  signInWithPassword?: (email: string, password: string) => Promise<{ error: unknown }>
  /** Dev-only: one-click sign-in as the seeded admin tester. */
  signInAsAdmin?: () => Promise<{ error: unknown }>
  onBack?: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'otp' | 'password'>('otp')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const devLogin = async () => {
    if (!signInAsAdmin) return
    setBusy(true)
    setErr(null)
    try {
      const { error } = await signInAsAdmin()
      if (error) setErr('Admin tester sign-in failed. Did you run `npm run seed:admin`?')
    } catch {
      setErr('Admin tester sign-in failed. Did you run `npm run seed:admin`?')
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      if (mode === 'password' && signInWithPassword) {
        const { error } = await signInWithPassword(email, password)
        if (error) setErr('That email and password didn’t match. Try again.')
      } else {
        const { error } = await signInWithOtp(email)
        if (error) setErr('We couldn’t send that code. Check the address and try again.')
        else setSent(true)
      }
    } catch {
      setErr(
        mode === 'password'
          ? 'That email and password didn’t match. Try again.'
          : 'We couldn’t send that code. Check the address and try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth bp-grid">
      {/* Left: the brand panel (the drawing) */}
      <aside className="auth__brand">
        <a className="brand auth__brand-mark" href="#/" aria-label="BtG home">
          <span className="brand__mark" aria-hidden="true"><span className="brand__core" /></span>
          <span className="brand__type"><strong>BtG</strong><em>Build the Guild</em></span>
        </a>
        <div className="auth__art">
          <HubSchematic variant="compact" />
        </div>
        <p className="auth__brand-line mono">
          ONE SOURCE OF TRUTH · VERSIONED + AUDITED · AU / NZ
        </p>
      </aside>

      {/* Right: the form (the title block) */}
      <main className="auth__pane">
        <div className="auth__card panel xhair">
          <span className="eyebrow">Sign in</span>

          {sent ? (
            <div className="auth__sent" role="status">
              <span className="auth__check" aria-hidden="true">→</span>
              <h1 className="auth__title">Check your email</h1>
              <p className="auth__lede">
                We sent a one-time sign-in code to <strong>{email || 'your inbox'}</strong>.
                It’s good for the next few minutes.
              </p>
              <button className="btn btn--ghost btn--sm" onClick={() => setSent(false)}>
                Use a different email
              </button>
            </div>
          ) : (
            <>
              <h1 className="auth__title">Welcome back to your<br />operating system.</h1>
              <p className="auth__lede">
                {mode === 'password'
                  ? 'Enter your email and password to sign in.'
                  : 'Enter your work email and we’ll send a one-time code. No password to forget.'}
              </p>
              <form className="auth__form" onSubmit={submit} noValidate>
                <label htmlFor="email" className="auth__label">Email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@yourbusiness.com.au"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="auth__input"
                />
                {mode === 'password' && (
                  <>
                    <label htmlFor="password" className="auth__label">Password</label>
                    <input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      placeholder="Your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="auth__input"
                    />
                  </>
                )}
                <div aria-live="polite">
                  {err && <p className="auth__err" role="alert">{err}</p>}
                </div>
                <button type="submit" className="btn btn--primary auth__submit" disabled={busy}>
                  {busy
                    ? mode === 'password' ? 'Signing in…' : 'Sending…'
                    : mode === 'password'
                      ? <>Sign in <span className="arrow">→</span></>
                      : <>Send code <span className="arrow">→</span></>}
                </button>
              </form>
              {signInWithPassword && (
                <button
                  type="button"
                  className="lp-link-btn auth__toggle-mode"
                  onClick={() => { setMode(mode === 'password' ? 'otp' : 'password'); setErr(null) }}
                  disabled={busy}
                  style={{ marginTop: '0.75rem' }}
                >
                  {mode === 'password'
                    ? '← Use a one-time email code instead'
                    : 'Sign in with a password instead →'}
                </button>
              )}
              {signInAsAdmin && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm auth__dev-login"
                  onClick={devLogin}
                  disabled={busy}
                  style={{ marginTop: '1rem' }}
                >
                  ⚡ Dev: sign in as admin tester
                </button>
              )}
            </>
          )}

          <footer className="auth__foot mono">
            {onBack ? (
              <button className="lp-link-btn auth__back" onClick={onBack}>← Back to site</button>
            ) : <span />}
            <span>REV v1.0 · SHEET 01</span>
          </footer>
        </div>
      </main>
    </div>
  )
}
