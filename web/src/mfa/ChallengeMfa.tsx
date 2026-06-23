import { useState } from 'react'
import { challengeAndVerify } from './mfaApi'
import { supabase } from '../supabase'

interface Props {
  factorId: string
  onVerified: () => void
}

export function ChallengeMfa({ factorId, onVerified }: Props) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { error: verifyError } = await challengeAndVerify(factorId, code)
      if (verifyError) {
        setError(verifyError.message)
      } else {
        onVerified()
      }
    } catch {
      setError('Verification failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: '10vh auto', padding: '2rem', fontFamily: 'sans-serif' }}>
      <h2>Two-Factor Verification</h2>
      <p>Enter the 6-digit code from your authenticator app to continue.</p>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="mfa-code">Code</label>
          <br />
          <input
            id="mfa-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            style={{ fontSize: '1.25rem', padding: '0.5rem', marginTop: '0.5rem', width: '100%' }}
          />
        </div>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button
          type="submit"
          disabled={loading || code.length !== 6}
          style={{ marginTop: '1rem', padding: '0.5rem 1.5rem' }}
        >
          {loading ? 'Verifying…' : 'Verify'}
        </button>
      </form>
      <button
        type="button"
        onClick={() => supabase.auth.signOut()}
        style={{ marginTop: '1rem', background: 'none', border: 'none', color: '#555', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
      >
        Sign out
      </button>
    </div>
  )
}
