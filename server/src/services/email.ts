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
