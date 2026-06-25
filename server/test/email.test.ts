import { describe, it, expect, vi } from 'vitest'
import { renderTemplate, createEmailService, createResendTransport, selectEmailTransport, consoleTransport } from '../src/services/email.js'

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

describe('createResendTransport', () => {
  function okFetch() {
    return vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }) as unknown as Response)
  }

  it('POSTs to the Resend API with auth header and json body', async () => {
    const fetchImpl = okFetch()
    const send = createResendTransport({ apiKey: 'rk_test', from: 'BYB <no@b.dev>', fetchImpl: fetchImpl as unknown as typeof fetch })
    await send({ to: 'u@x.dev', subject: 'Hi', html: '<p>Hi</p>' })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer rk_test')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'BYB <no@b.dev>', to: 'u@x.dev', subject: 'Hi', html: '<p>Hi</p>',
    })
  })

  it('resolves on a 2xx response', async () => {
    const send = createResendTransport({ apiKey: 'k', from: 'f', fetchImpl: okFetch() as unknown as typeof fetch })
    await expect(send({ to: 't', subject: 's', html: 'h' })).resolves.toBeUndefined()
  })

  it('throws on a non-2xx response, surfacing the status', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 422, text: async () => 'invalid from' }) as unknown as Response)
    const send = createResendTransport({ apiKey: 'k', from: 'f', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(send({ to: 't', subject: 's', html: 'h' })).rejects.toThrow(/422/)
  })

  it('throws on a network error', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED') })
    const send = createResendTransport({ apiKey: 'k', from: 'f', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(send({ to: 't', subject: 's', html: 'h' })).rejects.toThrow(/Resend request failed/)
  })

  it('throws a timeout error when the request exceeds timeoutMs', async () => {
    const hangingFetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_res, reject) => {
      init.signal?.addEventListener('abort', () => {
        const e = new Error('aborted'); e.name = 'AbortError'; reject(e)
      })
    }))
    const send = createResendTransport({ apiKey: 'k', from: 'f', timeoutMs: 10, fetchImpl: hangingFetch as unknown as typeof fetch })
    await expect(send({ to: 't', subject: 's', html: 'h' })).rejects.toThrow(/timed out/)
  })
})

describe('selectEmailTransport', () => {
  it('returns the console transport for provider "console"', () => {
    expect(selectEmailTransport({ provider: 'console', timeoutMs: 10000 })).toBe(consoleTransport)
  })

  it('returns a resend transport wired to apiKey, from, and timeoutMs for provider "resend"', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }) as unknown as Response)
    vi.stubGlobal('fetch', fetchImpl)
    try {
      const transport = selectEmailTransport({ provider: 'resend', resendApiKey: 'rk_live', from: 'BYB <no@b.dev>', timeoutMs: 10000 })
      expect(transport).not.toBe(consoleTransport)
      await transport({ to: 'u@x.dev', subject: 'Hi', html: '<p>Hi</p>' })

      expect(fetchImpl).toHaveBeenCalledTimes(1)
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('https://api.resend.com/emails')
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer rk_live')
      expect(JSON.parse(init.body as string)).toMatchObject({ from: 'BYB <no@b.dev>', to: 'u@x.dev' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('throws when provider is "resend" but resendApiKey/from are missing', () => {
    expect(() => selectEmailTransport({ provider: 'resend', timeoutMs: 10000 })).toThrow(/resend/i)
  })
})
