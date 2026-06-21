import { useState } from 'react'

export function Login({ signInWithOtp }: { signInWithOtp: (email: string) => Promise<{ error: unknown }> }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await signInWithOtp(email)
    if (!error) setSent(true)
  }
  if (sent) return <p>Check your email for a sign-in code.</p>
  return (
    <form onSubmit={submit}>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button type="submit">Send code</button>
    </form>
  )
}
