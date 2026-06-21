import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

  it('disables the button and shows Sending… while the request is in flight', async () => {
    let resolve!: (v: { error: null }) => void
    const signIn = vi.fn(() => new Promise<{ error: null }>((res) => { resolve = res }))
    render(<Login signInWithOtp={signIn} />)
    await userEvent.type(screen.getByLabelText(/email/i), 'a@test.dev')
    await userEvent.click(screen.getByRole('button', { name: /send code/i }))
    const btn = screen.getByRole('button', { name: /sending/i })
    expect(btn).toBeDisabled()
    resolve({ error: null })
    await screen.findByText(/check your email/i)
  })

  it('shows an OTP error and re-enables the button on failure', async () => {
    let reject!: (e: Error) => void
    const signIn = vi.fn(() => new Promise<{ error: unknown }>((_, rej) => { reject = rej }))
    render(<Login signInWithOtp={signIn} />)
    await userEvent.type(screen.getByLabelText(/email/i), 'a@test.dev')
    await userEvent.click(screen.getByRole('button', { name: /send code/i }))
    expect(screen.getByRole('button', { name: /sending/i })).toBeDisabled()
    reject(new Error('network error'))
    await screen.findByText(/check the address and try again/i)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /send code/i })).not.toBeDisabled()
    })
  })
})
