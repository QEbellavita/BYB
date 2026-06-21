import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Shell } from '../src/Shell'

describe('Shell', () => {
  it('shows the authed user email from /api/me', async () => {
    const fetchMe = vi.fn(async () => ({ id: 'u1', email: 'a@test.dev' }))
    render(<Shell fetchMe={fetchMe} onSignOut={() => {}} />)
    expect(await screen.findByText(/a@test.dev/)).toBeInTheDocument()
  })
})
