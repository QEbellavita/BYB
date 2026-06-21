import { describe, it, expect, vi } from 'vitest'
import { renderTemplate, createEmailService } from '../src/services/email.js'

describe('renderTemplate', () => {
  it('substitutes known tokens', () => {
    expect(renderTemplate('Hi {{name}}', { name: 'Sam' })).toBe('Hi Sam')
  })
  it('renders unknown tokens as empty', () => {
    expect(renderTemplate('Hi {{name}} {{missing}}', { name: 'Sam' })).toBe('Hi Sam ')
  })
})

describe('email service', () => {
  it('renders the body then calls the transport', async () => {
    const transport = vi.fn(async () => {})
    const svc = createEmailService(transport)
    await svc.send('to@test.dev', 'Welcome', 'Join {{workspace}}', { workspace: 'A Co' })
    expect(transport).toHaveBeenCalledWith({
      to: 'to@test.dev', subject: 'Welcome', html: 'Join A Co',
    })
  })
})
