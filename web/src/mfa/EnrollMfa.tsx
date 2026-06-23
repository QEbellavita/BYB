import { useState } from 'react'

interface EnrollMfaProps {
  enrollTotp: () => Promise<{ data: { id: string; totp: { qr_code: string; secret: string } } | null; error: { message: string } | null }>
  challengeAndVerify: (factorId: string, code: string) => Promise<{ data: unknown; error: { message: string } | null }>
}

export function EnrollMfa({ enrollTotp, challengeAndVerify }: EnrollMfaProps) {
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleEnroll() {
    setLoading(true)
    setError(null)
    const { data, error: err } = await enrollTotp()
    setLoading(false)
    if (err || !data) { setError(err?.message ?? 'Enroll failed'); return }
    setFactorId(data.id)
    setQrCode(data.totp.qr_code)
    setSecret(data.totp.secret)
  }

  async function handleVerify() {
    if (!factorId) return
    setLoading(true)
    setError(null)
    const { error: err } = await challengeAndVerify(factorId, code)
    setLoading(false)
    if (err) { setError(err.message); return }
    setEnabled(true)
  }

  if (enabled) return <p>MFA enabled</p>

  return (
    <div>
      {!factorId && (
        <button onClick={handleEnroll} disabled={loading}>Enable MFA</button>
      )}
      {factorId && qrCode && (
        <>
          <img src={qrCode} alt="QR code for MFA setup" />
          <details>
            <summary>Can't scan the QR? Enter this key manually</summary>
            <p><strong>Manual key (keep private):</strong> <code>{secret}</code></p>
          </details>
          <label htmlFor="mfa-code">Code</label>
          <input id="mfa-code" value={code} onChange={(e) => setCode(e.target.value)} />
          <button onClick={handleVerify} disabled={loading}>Verify</button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
