import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EnrollMfa } from '../../src/mfa/EnrollMfa'

describe('EnrollMfa', () => {
  it('clicking Enable MFA calls enrollTotp and renders QR + secret', async () => {
    const enrollTotp = vi.fn(async () => ({
      data: { id: 'factor-1', totp: { qr_code: 'data:image/svg+xml;base64,abc', secret: 'JBSWY3DPEHPK3PXP' } },
      error: null,
    }))
    const challengeAndVerify = vi.fn(async () => ({ data: {}, error: null }))
    render(<EnrollMfa enrollTotp={enrollTotp} challengeAndVerify={challengeAndVerify} />)
    await userEvent.click(screen.getByRole('button', { name: /enable mfa/i }))
    expect(enrollTotp).toHaveBeenCalled()
    expect(await screen.findByRole('img', { name: /qr/i })).toBeInTheDocument()
    expect(await screen.findByText(/JBSWY3DPEHPK3PXP/)).toBeInTheDocument()
  })

  it('entering a code calls challengeAndVerify then shows enabled state', async () => {
    const enrollTotp = vi.fn(async () => ({
      data: { id: 'factor-1', totp: { qr_code: 'data:image/svg+xml;base64,abc', secret: 'SECRET123' } },
      error: null,
    }))
    const challengeAndVerify = vi.fn(async () => ({ data: {}, error: null }))
    render(<EnrollMfa enrollTotp={enrollTotp} challengeAndVerify={challengeAndVerify} />)
    await userEvent.click(screen.getByRole('button', { name: /enable mfa/i }))
    await screen.findByRole('img', { name: /qr/i })
    await userEvent.type(screen.getByLabelText(/code/i), '123456')
    await userEvent.click(screen.getByRole('button', { name: /verify/i }))
    expect(challengeAndVerify).toHaveBeenCalledWith('factor-1', '123456')
    expect(await screen.findByText(/mfa enabled/i)).toBeInTheDocument()
  })

  it('shows error message on verify failure', async () => {
    const enrollTotp = vi.fn(async () => ({
      data: { id: 'factor-1', totp: { qr_code: 'data:image/svg+xml;base64,abc', secret: 'SECRET123' } },
      error: null,
    }))
    const challengeAndVerify = vi.fn(async () => ({ data: null, error: { message: 'Invalid code' } }))
    render(<EnrollMfa enrollTotp={enrollTotp} challengeAndVerify={challengeAndVerify} />)
    await userEvent.click(screen.getByRole('button', { name: /enable mfa/i }))
    await screen.findByRole('img', { name: /qr/i })
    await userEvent.type(screen.getByLabelText(/code/i), '000000')
    await userEvent.click(screen.getByRole('button', { name: /verify/i }))
    expect(await screen.findByText(/invalid code/i)).toBeInTheDocument()
  })
})
