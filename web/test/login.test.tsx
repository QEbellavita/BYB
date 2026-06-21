import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Login } from '../src/Login'

describe('Login', () => {
  it('sends an OTP for the entered email', async () => {
    const signIn = vi.fn(async () => ({ error: null }))
    render(<Login signInWithOtp={signIn} />)
    await userEvent.type(screen.getByLabelText(/email/i), 'a@test.dev')
    await userEvent.click(screen.getByRole('button', { name: /send code/i }))
    expect(signIn).toHaveBeenCalledWith('a@test.dev')
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument()
  })
})
