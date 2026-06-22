import { useEffect, useState } from 'react'

interface Factor { id: string; friendly_name: string; status: string }

interface ManageMfaProps {
  listFactors: () => Promise<{ data: { totp: Factor[] } | null; error: { message: string } | null }>
  unenroll: (factorId: string) => Promise<{ error: { message: string } | null }>
}

export function ManageMfa({ listFactors, unenroll }: ManageMfaProps) {
  const [factors, setFactors] = useState<Factor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listFactors().then(({ data, error: err }) => {
      setLoading(false)
      if (err || !data) { setError(err?.message ?? 'Failed to load'); return }
      setFactors(data.totp)
    })
  }, [listFactors])

  async function handleDisable(factorId: string) {
    const { error: err } = await unenroll(factorId)
    if (err) { setError(err.message); return }
    setFactors((prev) => prev.filter((f) => f.id !== factorId))
  }

  if (loading) return <p>Loading…</p>

  return (
    <div>
      {factors.length === 0 && <p>No MFA factors enrolled.</p>}
      {factors.map((f) => (
        <div key={f.id}>
          <span>{f.friendly_name}</span>
          <button onClick={() => handleDisable(f.id)}>Disable</button>
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
