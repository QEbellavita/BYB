import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ManageMfa } from '../../src/mfa/ManageMfa'

describe('ManageMfa', () => {
  it('lists factors returned by listFactors', async () => {
    const listFactors = vi.fn(async () => ({
      data: { totp: [{ id: 'f1', friendly_name: 'My Authenticator', status: 'verified' }] },
      error: null,
    }))
    const unenroll = vi.fn(async () => ({ error: null }))
    render(<ManageMfa listFactors={listFactors} unenroll={unenroll} />)
    expect(await screen.findByText(/my authenticator/i)).toBeInTheDocument()
  })

  it('clicking Disable calls unenroll with factorId', async () => {
    const listFactors = vi.fn(async () => ({
      data: { totp: [{ id: 'f1', friendly_name: 'My Authenticator', status: 'verified' }] },
      error: null,
    }))
    const unenroll = vi.fn(async () => ({ error: null }))
    render(<ManageMfa listFactors={listFactors} unenroll={unenroll} />)
    await screen.findByText(/my authenticator/i)
    await userEvent.click(screen.getByRole('button', { name: /disable/i }))
    expect(unenroll).toHaveBeenCalledWith('f1')
    await waitFor(() => {
      expect(screen.queryByText(/my authenticator/i)).not.toBeInTheDocument()
    })
  })

  it('shows empty state when no factors', async () => {
    const listFactors = vi.fn(async () => ({ data: { totp: [] }, error: null }))
    const unenroll = vi.fn(async () => ({ error: null }))
    render(<ManageMfa listFactors={listFactors} unenroll={unenroll} />)
    expect(await screen.findByText(/no mfa factors/i)).toBeInTheDocument()
  })
})
