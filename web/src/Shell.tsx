import { useEffect, useState } from 'react'

interface Me { id: string; email: string | null }

export function Shell({ fetchMe, onSignOut }: { fetchMe: () => Promise<Me>; onSignOut: () => void }) {
  const [me, setMe] = useState<Me | null>(null)
  useEffect(() => { fetchMe().then(setMe).catch(() => setMe(null)) }, [fetchMe])
  return (
    <div>
      <header>BYB Platform {me ? `— ${me.email}` : ''}</header>
      <button onClick={onSignOut}>Sign out</button>
    </div>
  )
}
