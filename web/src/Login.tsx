import { useState } from 'react'
import { HubSchematic } from './components/HubSchematic'
import './Login.css'

export function Login({
  signInWithOtp,
  onBack,
}: {
  signInWithOtp: (email: string) => Promise<{ error: unknown }>
  onBack?: () => void
}) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const { error } = await signInWithOtp(email)
      if (error) setErr('We couldn’t send that code. Check the address and try again.')
      else setSent(true)
    } catch {
      setErr('We couldn’t send that code. Check the address and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth bp-grid">
      {/* Left: the brand panel (the drawing) */}
      <aside className="auth__brand">
        <a className="brand auth__brand-mark" href="#/" aria-label="BYB home">
          <span className="brand__mark" aria-hidden="true"><span className="brand__core" /></span>
          <span className="brand__type"><strong>BYB</strong><em>Build Your Business</em></span>
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
                Enter your work email and we’ll send a one-time code. No password to forget.
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
                <div aria-live="polite">
                  {err && <p className="auth__err" role="alert">{err}</p>}
                </div>
                <button type="submit" className="btn btn--primary auth__submit" disabled={busy}>
                  {busy ? 'Sending…' : <>Send code <span className="arrow">→</span></>}
                </button>
              </form>
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
