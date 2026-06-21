import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Shell } from '../src/Shell'

describe('Shell', () => {
  it('shows the authed user email from /api/me', async () => {
    const fetchMe = vi.fn(async () => ({ id: 'u1', email: 'a@test.dev' }))
    render(<Shell fetchMe={fetchMe} onSignOut={() => {}} />)
    expect(await screen.findByText(/a@test.dev/)).toBeInTheDocument()
  })

  it('shows Loading your workspace… before the account loads', async () => {
    let resolve!: (v: { id: string; email: string }) => void
    const fetchMe = vi.fn(() => new Promise<{ id: string; email: string }>((res) => { resolve = res }))
    render(<Shell fetchMe={fetchMe} onSignOut={() => {}} />)
    expect(screen.getByText(/loading your workspace/i)).toBeInTheDocument()
    resolve({ id: 'u1', email: 'a@test.dev' })
    await screen.findByText(/a@test.dev/)
  })

  it('shows Could not load your account on failure', async () => {
    const fetchMe = vi.fn(() => Promise.reject(new Error('network')))
    render(<Shell fetchMe={fetchMe} onSignOut={() => {}} />)
    await screen.findByText(/could not load your account/i)
    await waitFor(() => {
      expect(screen.queryByText(/loading your workspace/i)).not.toBeInTheDocument()
    })
  })
})
