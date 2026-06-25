# PR-1 Resend Email Transport + Productionize Runbook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the invite-email console stub with config-driven Resend delivery (raw `fetch`, no SDK), and document the non-code productionize steps.

**Architecture:** Add a `createResendTransport` implementing the existing `EmailTransport` interface, a `selectEmailTransport(config)` factory, and an `email` block on `AppConfig` with explicit provider selection + fail-fast validation. Wire selection into `app.ts`. The transport throws on failure, which plugs into onboarding's existing per-invite try/catch + `retryInvitation` contract. Docs cover Resend setup and the ops runbook.

**Tech Stack:** Node 22 (global `fetch`), TypeScript (strict, ESM, `.js` import specifiers), Express 5, Vitest. Zero new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-06-25-pr1-productionize-email-and-runbook-design.md`

## Global Constraints

- **Node 22+**, TypeScript strict + ESM — local imports use `.js` extensions.
- **Zero new runtime dependencies** (raw `fetch`, no `resend` SDK / `nodemailer`). Bank-grade SCA/gitleaks standard.
- **No silent degrade:** misconfigured `resend` provider → `loadConfig()` throws at startup; `NODE_ENV=production` on `console` → one `console.warn`.
- **Transport throws on failure** (non-2xx, network error, timeout); the console stub never throws. Do not add retries in the transport (onboarding's `retryInvitation` is the retry path).
- Warning prefix convention: `[email] ...` (mirrors the existing `[cors] ...` warning).
- Do not change onboarding flow, route handlers, the RLS/user-JWT data path, or DB.
- Every task ends green: `npm test` (server) and, where the app is touched, the build/typecheck.
- Conventional commits; work on branch `feat/pr1-resend-email`.

---

### Task 1: `createResendTransport` (Resend HTTP transport)

**Files:**
- Modify: `server/src/services/email.ts` (append; do not change existing exports)
- Test: `server/test/email.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: existing `EmailTransport` type from `email.ts` (`(msg: { to: string; subject: string; html: string }) => Promise<void>`).
- Produces: `createResendTransport(opts: { apiKey: string; from: string; timeoutMs?: number; fetchImpl?: typeof fetch }): EmailTransport`.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/email.test.ts`:

```ts
import { createResendTransport } from '../src/services/email.js'

describe('createResendTransport', () => {
  function okFetch() {
    return vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }) as unknown as Response)
  }

  it('POSTs to the Resend API with auth header and json body', async () => {
    const fetchImpl = okFetch()
    const send = createResendTransport({ apiKey: 'rk_test', from: 'BYB <no@b.dev>', fetchImpl: fetchImpl as unknown as typeof fetch })
    await send({ to: 'u@x.dev', subject: 'Hi', html: '<p>Hi</p>' })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
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
    await expect(send({ to: 't', subject: 's', html: 'h' })).rejects.toThrow(/failed/)
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace server -- email`
Expected: FAIL — `createResendTransport is not a function` / not exported.

- [ ] **Step 3: Implement `createResendTransport`**

Append to `server/src/services/email.ts` (leave `renderTemplate`, `EmailTransport`, `consoleTransport`, `createEmailService` exactly as they are):

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace server -- email`
Expected: PASS — all `createResendTransport` tests plus the existing `renderTemplate` / `email service` tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/email.ts server/test/email.test.ts
git commit -m "feat(server): add Resend email transport (raw fetch, throwing, timeout)"
```

---

### Task 2: Email config block + fail-fast validation

**Files:**
- Modify: `server/src/config.ts`
- Test: `server/test/config.test.ts` (create)

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces: `AppConfig.email: { provider: 'console' | 'resend'; resendApiKey?: string; from?: string; timeoutMs: number }`, populated and validated by `loadConfig()`.

- [ ] **Step 1: Write the failing tests**

Create `server/test/config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadConfig } from '../src/config.js'

const BASE = {
  SUPABASE_URL: 'http://localhost',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
}

describe('loadConfig email block', () => {
  let saved: NodeJS.ProcessEnv
  beforeEach(() => {
    saved = { ...process.env }
    delete process.env.EMAIL_PROVIDER
    delete process.env.RESEND_API_KEY
    delete process.env.EMAIL_FROM
    delete process.env.EMAIL_TIMEOUT_MS
    delete process.env.NODE_ENV
    Object.assign(process.env, BASE)
  })
  afterEach(() => { process.env = saved })

  it('defaults to the console provider with a 10s timeout', () => {
    const cfg = loadConfig()
    expect(cfg.email.provider).toBe('console')
    expect(cfg.email.timeoutMs).toBe(10000)
  })

  it('parses a valid resend config', () => {
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 'rk_live'
    process.env.EMAIL_FROM = 'BYB <no@b.dev>'
    process.env.EMAIL_TIMEOUT_MS = '5000'
    const cfg = loadConfig()
    expect(cfg.email).toEqual({
      provider: 'resend', resendApiKey: 'rk_live', from: 'BYB <no@b.dev>', timeoutMs: 5000,
    })
  })

  it('throws when provider=resend but RESEND_API_KEY is missing', () => {
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.EMAIL_FROM = 'BYB <no@b.dev>'
    expect(() => loadConfig()).toThrow(/RESEND_API_KEY/)
  })

  it('throws when provider=resend but EMAIL_FROM is missing', () => {
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 'rk_live'
    expect(() => loadConfig()).toThrow(/EMAIL_FROM/)
  })

  it('throws on an unknown provider', () => {
    process.env.EMAIL_PROVIDER = 'sendgrid'
    expect(() => loadConfig()).toThrow(/EMAIL_PROVIDER/)
  })

  it('warns (not throws) when production is left on the console provider', () => {
    process.env.NODE_ENV = 'production'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cfg = loadConfig()
    expect(cfg.email.provider).toBe('console')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[email]'))
    warn.mockRestore()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace server -- config`
Expected: FAIL — `cfg.email` is undefined.

- [ ] **Step 3: Implement the email config block**

Edit `server/src/config.ts`. Add to the `AppConfig` interface (after `supabaseServiceRoleKey`):

```ts
  email: {
    provider: 'console' | 'resend'
    resendApiKey?: string
    from?: string
    timeoutMs: number
  }
```

Add this helper above `loadConfig`:

```ts
function loadEmailConfig(): AppConfig['email'] {
  const provider = process.env.EMAIL_PROVIDER ?? 'console'
  if (provider !== 'console' && provider !== 'resend') {
    throw new Error(`Invalid EMAIL_PROVIDER: "${provider}" (expected "console" or "resend")`)
  }
  const timeoutMs = Number(process.env.EMAIL_TIMEOUT_MS ?? 10000)
  if (provider === 'resend') {
    const resendApiKey = required('RESEND_API_KEY')
    const from = required('EMAIL_FROM')
    return { provider, resendApiKey, from, timeoutMs }
  }
  if (process.env.NODE_ENV === 'production') {
    console.warn('[email] EMAIL_PROVIDER is "console" in production — invite emails will NOT be delivered; set EMAIL_PROVIDER=resend')
  }
  return { provider: 'console', timeoutMs }
}
```

Add `email: loadEmailConfig(),` to the object returned by `loadConfig()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace server -- config`
Expected: PASS — all six cases.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --workspace server`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add server/src/config.ts server/test/config.test.ts
git commit -m "feat(server): add email config block with fail-fast validation"
```

---

### Task 3: `selectEmailTransport` factory + wire into `app.ts`

**Files:**
- Modify: `server/src/services/email.ts` (add `selectEmailTransport`)
- Modify: `server/src/app.ts` (line ~84, and the import on line 32)
- Test: `server/test/email.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `createResendTransport` (Task 1), `consoleTransport` (existing), `AppConfig` (Task 2).
- Produces: `selectEmailTransport(config: Pick<AppConfig, 'email'>): EmailTransport`.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/email.test.ts`:

```ts
import { selectEmailTransport, consoleTransport } from '../src/services/email.js'

describe('selectEmailTransport', () => {
  it('returns the console transport for the console provider', () => {
    const t = selectEmailTransport({ email: { provider: 'console', timeoutMs: 10000 } })
    expect(t).toBe(consoleTransport)
  })

  it('returns a working Resend transport for the resend provider', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }) as unknown as Response)
    // selection builds the transport from config; verify it hits the network layer.
    const t = selectEmailTransport(
      { email: { provider: 'resend', resendApiKey: 'k', from: 'f', timeoutMs: 10000 } },
      fetchImpl as unknown as typeof fetch,
    )
    await t({ to: 't', subject: 's', html: 'h' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace server -- email`
Expected: FAIL — `selectEmailTransport is not a function`.

- [ ] **Step 3: Implement `selectEmailTransport`**

Append to `server/src/services/email.ts`. Add a type-only import at the top of the file (ESM, `.js` specifier):

```ts
import type { AppConfig } from '../config.js'
```

Then:

```ts
export function selectEmailTransport(
  config: Pick<AppConfig, 'email'>,
  fetchImpl?: typeof fetch,
): EmailTransport {
  const e = config.email
  if (e.provider === 'resend') {
    return createResendTransport({
      apiKey: e.resendApiKey as string,
      from: e.from as string,
      timeoutMs: e.timeoutMs,
      fetchImpl,
    })
  }
  return consoleTransport
}
```

(The `fetchImpl` param is optional and exists only so the selection test can inject a mock; production passes nothing and the transport uses global `fetch`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace server -- email`
Expected: PASS — Task 1 + selection tests.

- [ ] **Step 5: Wire selection into `app.ts`**

In `server/src/app.ts`, change the import on line 32 from:

```ts
import { consoleTransport, createEmailService } from './services/email.js'
```

to:

```ts
import { selectEmailTransport, createEmailService } from './services/email.js'
```

And change the email-service construction (the `// ---- Email service ----` block, ~line 84) from:

```ts
    const emailService = createEmailService(consoleTransport)
```

to:

```ts
    const emailService = createEmailService(selectEmailTransport(config))
```

- [ ] **Step 6: Wrap the invite body in minimal inline-styled HTML**

In `server/src/app.ts`, in the `sendInvite` callback (~line 153–160), replace the plain-text body argument with an inline-styled HTML version. Change:

```ts
        sendInvite: async (invite) => {
          await emailService.send(
            invite.email,
            'You have been invited to a workspace',
            'You have been invited to join workspace {{workspaceId}}. Your invite token is {{token}}.',
            { workspaceId: invite.workspaceId, token: invite.token }
          )
        },
```

to:

```ts
        sendInvite: async (invite) => {
          await emailService.send(
            invite.email,
            'You have been invited to a workspace',
            '<div style="font-family:system-ui,Arial,sans-serif;font-size:15px;color:#111;line-height:1.5">'
              + '<p>You have been invited to join a workspace on <strong>BYB</strong>.</p>'
              + '<p>Your invite token is:</p>'
              + '<p style="font-family:monospace;font-size:16px;background:#f4f4f5;padding:8px 12px;border-radius:6px;display:inline-block">{{token}}</p>'
              + '<p style="color:#666;font-size:13px">Workspace: {{workspaceId}}</p>'
              + '</div>',
            { workspaceId: invite.workspaceId, token: invite.token }
          )
        },
```

(Tokens `{{token}}`/`{{workspaceId}}` are still substituted by the existing `renderTemplate`; no behavior change — onboarding tests assert delivery status, not body HTML. The clickable accept-link is a separate follow-up that needs the redemption flow.)

- [ ] **Step 7: Run the full server suite + typecheck**

Run: `npm test --workspace server && npm run typecheck --workspace server`
Expected: PASS — full suite green (incl. existing `app`/onboarding tests), no type errors. The default config provider is `console`, so existing app tests are unaffected.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/email.ts server/src/app.ts server/test/email.test.ts
git commit -m "feat(server): select email transport from config, wire into app, html invite body"
```

---

### Task 4: Docs — `.env.example`, DEPLOY Email section, productionize runbook

**Files:**
- Modify: `.env.example`
- Modify: `docs/DEPLOY.md`
- Create: `docs/PRODUCTIONIZE.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Update `.env.example`**

In `.env.example`, under the `# server` block (after `SUPABASE_SERVICE_ROLE_KEY=...`), add:

```
# email (invite delivery). Default provider is the console stub.
EMAIL_PROVIDER=console
# To send real email, set EMAIL_PROVIDER=resend and fill these (domain must be verified in Resend):
# RESEND_API_KEY=
# EMAIL_FROM="BYB <noreply@yourdomain>"
# EMAIL_TIMEOUT_MS=10000
```

- [ ] **Step 2: Replace the DEPLOY.md email follow-up with a real section**

In `docs/DEPLOY.md`, under "## Notes / follow-ups", replace the bullet that begins "No emails are sent in production yet" with a reference to the new section, then add this section just above "## Notes / follow-ups":

```markdown
## Email (Resend)

Invite/notification email uses a pluggable transport. Default `EMAIL_PROVIDER=console`
(logs only — does not send). To deliver real email via **Resend**:

1. **Verify a sending domain in Resend.** Resend dashboard → Domains → Add domain →
   publish the shown SPF + DKIM DNS records on that domain → wait until **Verified**.
2. **Create an API key** (Resend → API Keys) with send permission.
3. **Set server env vars** (server service only — never on the web service):
   | var | value |
   |-----|-------|
   | `EMAIL_PROVIDER` | `resend` |
   | `RESEND_API_KEY` | the Resend API key |
   | `EMAIL_FROM` | a from-address on the **verified** domain, e.g. `BYB <noreply@yourdomain>` |
   | `EMAIL_TIMEOUT_MS` | optional, default `10000` |
4. Redeploy the server. On boot, an invalid/missing `RESEND_API_KEY`/`EMAIL_FROM`
   while `EMAIL_PROVIDER=resend` makes the server **fail fast** (it will not start);
   leaving production on `console` logs a startup warning. A failed send is recorded
   per-invite (`invitesFailed`) and can be re-sent via the onboarding retry path.
```

- [ ] **Step 3: Create `docs/PRODUCTIONIZE.md`**

Create `docs/PRODUCTIONIZE.md`:

```markdown
# BYB Platform — Productionize Runbook

The build is staging-deployed and E2E-verified. This checklist covers the steps
to a real production environment. Code items have their own spec→plan cycles;
the rest are dashboard/DNS actions. **Do the Supabase swap before any real
customer data lands.**

## 1. Supabase production project (BLOCKED — external)
Staging runs on the user's own Supabase `byb` project. Production target is
**Delilah's BYB** project (org `hfmgyospmdymoijwjewu`). Blocked: the operator is a
non-owner member there.
- **Unblock:** Delilah resets/shares the DB password, **or** makes the operator an org Owner.
- **Then:** `supabase link --project-ref <delilah-byb-ref>` → `supabase db push` →
  `supabase config push` (carries `[auth.mfa]`) → update Railway server env
  `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` and web
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` → set Supabase Auth Site URL.
- An empty-DB swap is trivial; a populated one is a migration + privacy event — do it first.

## 2. Custom domain (web + API)
- Add Railway custom domains for the web and server services; create the CNAME
  records the Railway dashboard shows.
- Update server `CORS_ORIGIN` to the web custom domain, web `VITE_API_URL` to the
  API custom domain (VITE_* is build-time → redeploy web), and the Supabase Auth
  **Site URL** to the web custom domain.

## 3. Email (Resend)
See `docs/DEPLOY.md` → **Email (Resend)**: verify a domain (DNS), set the server
env vars, flip `EMAIL_PROVIDER=resend`.

## 4. Backups / PITR
Enable backups in the Supabase dashboard (Database → Backups). Point-in-Time
Recovery requires the Pro plan — enable it for a money app.

## 5. Uptime monitoring
Add an external uptime check (e.g. UptimeRobot / Better Uptime) hitting the API
`/health` endpoint (returns `{"status":"ok"}`).

## 6. Log retention
Review Railway log retention on both services and Supabase log settings; retain
enough for incident review per the compliance standard.

## 7. Error monitoring — Sentry (next code cycle)
Not yet built. Planned as its own spec→plan→build: `@sentry/node` on the server
and `@sentry/react` on the web, gated by a `SENTRY_DSN` env var.
```

- [ ] **Step 4: Verify nothing is broken**

Run: `npm test --workspace server`
Expected: PASS (docs-only change; suite still green).

- [ ] **Step 5: Commit**

```bash
git add .env.example docs/DEPLOY.md docs/PRODUCTIONIZE.md
git commit -m "docs(pr1): Resend email setup + productionize runbook"
```

---

## Final verification (after all tasks)

- [ ] `npm test --workspace server` — full server suite green.
- [ ] `npm run typecheck --workspace server` — no type errors.
- [ ] `npm run build --workspace server` — production build compiles.
- [ ] Confirm `git log` shows the four task commits on `feat/pr1-resend-email`.
- [ ] Push branch and open a PR; let CI (`.github/workflows/ci.yml`, incl. SCA + gitleaks) go green before merge.

## Self-review notes (coverage vs spec)

- Spec §"createResendTransport" → Task 1 (URL/auth/body, 2xx resolve, non-2xx throw, network throw, timeout throw). ✓
- Spec §"selectEmailTransport" → Task 3. ✓
- Spec §"config.ts email block" (default console, resend parse, missing key/from throw, unknown provider throw, prod-console warn) → Task 2. ✓
- Spec §"app.ts wire" → Task 3 steps 5–6. ✓
- Spec §"email content (minimal HTML)" → Task 3 Step 6 (concrete inline-styled HTML body at the `sendInvite` call site in `app.ts`, tokens preserved). ✓
- Spec §"docs" (.env.example, DEPLOY Email section, PRODUCTIONIZE.md) → Task 4. ✓
- Global constraint "zero new deps" → no `package.json` dependency changes in any task. ✓
```
