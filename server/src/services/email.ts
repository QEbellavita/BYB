export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => vars[key] ?? '')
}

export type EmailTransport = (msg: { to: string; subject: string; html: string }) => Promise<void>

export const consoleTransport: EmailTransport = async (msg) => {
  console.log(`[email] to=${msg.to} subject="${msg.subject}"\n${msg.html}`)
}

export function createEmailService(transport: EmailTransport) {
  return {
    async send(to: string, subject: string, body: string, vars: Record<string, string> = {}) {
      await transport({ to, subject, html: renderTemplate(body, vars) })
    },
  }
}

/**
 * Pick the email transport that matches the loaded email config.
 * `console` (default) logs to stdout; `resend` delivers via the Resend API.
 * Keeps the wiring in one place so `EMAIL_PROVIDER` actually takes effect.
 */
export function selectEmailTransport(cfg: {
  provider: 'console' | 'resend'
  resendApiKey?: string
  from?: string
  timeoutMs: number
}): EmailTransport {
  if (cfg.provider === 'resend') {
    if (!cfg.resendApiKey || !cfg.from) {
      throw new Error('[email] resend provider requires RESEND_API_KEY and EMAIL_FROM')
    }
    return createResendTransport({ apiKey: cfg.resendApiKey, from: cfg.from, timeoutMs: cfg.timeoutMs })
  }
  return consoleTransport
}

export function createResendTransport(opts: {
  apiKey: string
  from: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): EmailTransport {
  const { apiKey, from, timeoutMs = 10000, fetchImpl = fetch } = opts
  return async (msg) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to: msg.to, subject: msg.subject, html: msg.html }),
        signal: controller.signal,
      })
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(`[email] Resend request timed out after ${timeoutMs}ms`)
      }
      throw new Error(`[email] Resend request failed: ${(err as Error).message}`)
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '')
      throw new Error(`[email] Resend returned ${res.status}: ${bodyText.slice(0, 200)}`)
    }
  }
}
