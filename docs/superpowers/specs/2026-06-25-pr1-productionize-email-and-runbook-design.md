# PR-1 — Productionize: Resend email transport + ops runbook (design spec)

**Date:** 2026-06-25 · **Status:** approved (brainstorm) → ready for plan
**Track:** Productionize the deployment (PR track), phase PR-1. First step of the "productionize the deployment" item in the bigger-picture handoff (`~/BYB-bigger-picture-handoff.md`, outside the repo).

## Goal

Replace the invite-email **console stub** with real delivery via **Resend** (the chosen stack), so the platform can invite real users — the explicit blocker called out in the handoff and `docs/DEPLOY.md`. Plus a documentation-only **productionize runbook** for the non-code ops items (custom domain, Supabase backups/PITR, uptime, log retention, and the blocked Supabase prod swap), so the path to a real production environment is captured and actionable.

This is a money/compliance app: an invite that silently fails to send is a real failure, so configuration is **explicit and fail-fast**, never a silent degrade.

## Scope

- **In scope (code):** the Express API only (`server/`) — a new Resend transport, config-driven transport selection, config validation, and wiring in `app.ts`. The existing `EmailTransport` abstraction and `createEmailService` are reused unchanged.
- **In scope (docs):** `.env.example`, the email section of `docs/DEPLOY.md`, and a new `docs/PRODUCTIONIZE.md` ops runbook.
- **Out of scope (this phase):**
  - **Sentry / error monitoring** — its own PR-track code cycle (spec→plan→build); listed in the runbook as the next code item but not built here.
  - **Invite-acceptance UX** — a clickable accept link + redemption page + the token-consume route. No redemption flow exists yet (verified: no accept-invite path in `web/src` or `server/src`); building it is a separate feature. This phase keeps the existing token-based invite content, just delivered via real email.
  - **The actual Supabase prod swap, custom domain, backups, uptime** — these are dashboard/DNS actions (documented in the runbook), and the Supabase swap is externally blocked (non-owner of Delilah's org).
  - No business-logic, route-handler, onboarding-flow, or DB changes. Invite **failure handling already exists and is correct** (see "Current state").

## Decisions (locked during brainstorm 2026-06-25)

1. **HTTP via raw `fetch`, no SDK.** Node 22 has global `fetch`. The Resend call is a single `POST https://api.resend.com/emails` with a Bearer header and a `{from,to,subject,html}` JSON body — adding the `resend` npm SDK (or `nodemailer`+SMTP) is unjustified dependency/supply-chain surface against the bank-grade SCA/gitleaks standard, and `fetch` is trivial to mock in tests. Net new runtime dependencies: **zero**.
2. **Explicit provider selection + fail-fast.** `EMAIL_PROVIDER` env (`console` | `resend`), default `console`. When `resend` is selected but `RESEND_API_KEY` or `EMAIL_FROM` is missing, `loadConfig()` **throws at startup** (no silent fallback). When `NODE_ENV=production` and the provider is still `console`, emit a loud one-time `console.warn` (mirrors the existing `CORS_ORIGIN` production warning). *Not* a hard prod requirement — so prod can boot before the sending domain's DNS is verified.
3. **Transport throws on failure.** The Resend transport throws on any non-2xx response or network/abort error. This is deliberate: onboarding's `finish()` already wraps each `sendInvite` in a per-invite `try/catch` that marks delivery `'sent'`/`'failed'` and tallies `invitesSent`/`invitesFailed`, and `retryInvitation()` already exists. A throwing transport plugs straight into that contract; the console stub never throws.
4. **Timeout.** The transport wraps `fetch` in an `AbortController` timeout (`EMAIL_TIMEOUT_MS`, default 10000) so a hung Resend call cannot stall onboarding-finish.
5. **Ops runbook is a separate file** (`docs/PRODUCTIONIZE.md`), keeping `docs/DEPLOY.md` focused on the build/deploy mechanics it already documents.

## Current state (grounding)

- `server/src/services/email.ts` defines `EmailTransport = (msg: {to, subject, html}) => Promise<void>`, the `consoleTransport` stub, `createEmailService(transport)` (renders the body then calls the transport), and `renderTemplate(body, vars)` (`{{var}}` substitution).
- `server/src/app.ts:84` hardcodes `const emailService = createEmailService(consoleTransport)`. The onboarding service's `sendInvite` callback (`app.ts:154`) calls `emailService.send(email, subject, body, vars)` with a token-based body.
- `server/src/modules/onboarding/service.ts` `finish()` (lines ~335–360) commits the session via `completionStore.complete()` **first** (persisting invite rows + tokens), **then** loops invites with per-invite `try/catch` → `markInviteDelivery(id, 'sent'|'failed')`. `retryInvitation()` (lines ~362–376) re-sends a committed/failed draft. ⇒ Email delivery is already decoupled from invite persistence; a send failure never rolls back onboarding.
- `server/src/config.ts` `loadConfig()` reads `port`, `supabaseUrl`, `supabaseAnonKey`, `supabaseServiceRoleKey` via a `required()` helper.
- No accept-invite/redemption flow exists in `web/src` or `server/src` (grep-verified).
- `docs/DEPLOY.md` ends with a follow-up note: *"No emails are sent in production yet — invite delivery uses a console transport; wire a real transport before inviting real users."*

## Architecture / components

Each unit is small and independently testable (Vitest; mock global `fetch` — never hit the live API).

### 1. `server/src/services/email.ts` — add `createResendTransport` (same file, additive)
`createResendTransport(opts: { apiKey: string; from: string; timeoutMs?: number; fetchImpl?: typeof fetch }): EmailTransport`

- Returns an `EmailTransport`. On call, `POST https://api.resend.com/emails` with:
  - headers `Authorization: Bearer ${apiKey}`, `Content-Type: application/json`
  - body `JSON.stringify({ from, to: msg.to, subject: msg.subject, html: msg.html })`
  - an `AbortController` aborting after `timeoutMs` (default 10000).
- **Success:** response `res.ok` (2xx) → resolve.
- **Failure:** non-2xx → throw `Error` including status + (truncated) response body text; network error / abort → throw (abort surfaced as a clear timeout error). No retries here — retry is the onboarding layer's existing `retryInvitation`.
- `fetchImpl` param defaults to global `fetch`; it exists purely so tests inject a mock (keeps the unit pure/testable). `consoleTransport`, `createEmailService`, `renderTemplate` are untouched.

### 2. `server/src/services/email.ts` — `selectEmailTransport(config)`
A pure factory (exported from `email.ts`) mapping config → transport:
- `config.email.provider === 'resend'` → `createResendTransport({ apiKey, from, timeoutMs })`
- otherwise → `consoleTransport`

Kept as a named export so it is unit-testable without constructing the whole app.

### 3. `server/src/config.ts` — extend `AppConfig`
Add an `email` block:
```
email: {
  provider: 'console' | 'resend'   // EMAIL_PROVIDER, default 'console'
  resendApiKey?: string            // RESEND_API_KEY
  from?: string                    // EMAIL_FROM, e.g. "BYB <noreply@buildtheguild.com.au>"
  timeoutMs: number                // EMAIL_TIMEOUT_MS, default 10000
}
```
Validation in `loadConfig()`:
- `EMAIL_PROVIDER` parsed; unknown value → throw (only `console`/`resend` allowed).
- provider `resend` and missing `RESEND_API_KEY` or `EMAIL_FROM` → throw (`Missing required env var: ...` style, matching the existing `required()` message shape).
- provider `console` while `NODE_ENV==='production'` → one `console.warn` (non-fatal). Placed so it fires once at startup, consistent with how CORS warns.

### 4. `server/src/app.ts` — wire selection
Replace `createEmailService(consoleTransport)` with `createEmailService(selectEmailTransport(config))`. No other change to the onboarding/email call sites.

### 5. Email content (minimal HTML)
Keep the existing subject and token-based body, but pass an inline-styled HTML wrapper as the body template (still rendered through `renderTemplate`, so `{{workspaceId}}`/`{{token}}` substitution is unchanged). Inline styles only (email-client safe), no external assets. The richer branded template + accept link is an explicit follow-up (depends on the redemption flow, out of scope).

## Testing

Server unit tests (Vitest, mock `fetch`/inject `fetchImpl` — no network):
- **`createResendTransport`**
  - calls fetch with the correct URL, `Authorization: Bearer` header, and JSON body containing `from`/`to`/`subject`/`html`.
  - resolves on a 2xx response.
  - throws on a non-2xx response (e.g. 422 invalid `from`), surfacing status.
  - throws on a network error.
  - throws (clear timeout error) when the request exceeds `timeoutMs` (abort).
- **`loadConfig` email block**
  - default → provider `console`, `timeoutMs` 10000.
  - provider `resend` with key + from → parsed values present.
  - provider `resend` missing key → throws; missing from → throws.
  - unknown provider → throws.
- **`selectEmailTransport`** → returns `consoleTransport` for `console`; returns a working resend transport (its fetch is invoked) for `resend`.
- Existing `server/test/email.test.ts` (`renderTemplate`, `createEmailService`) stays green.
- The full server suite (`npm test`) and pgTAP gate (`npm run db:test`) stay green; CI (`.github/workflows/ci.yml`) green before merge.

## Docs deliverables

1. **`.env.example`** — append commented email vars: `EMAIL_PROVIDER=console`, `# RESEND_API_KEY=`, `# EMAIL_FROM="BYB <noreply@yourdomain>"`, `# EMAIL_TIMEOUT_MS=10000`.
2. **`docs/DEPLOY.md`** — replace the "no emails in prod yet" follow-up with an **Email (Resend)** subsection: the env vars (server only), the Resend **domain verification** step (add domain in Resend → publish the SPF/DKIM DNS records → wait for verified), and the flip to `EMAIL_PROVIDER=resend`. Note `EMAIL_FROM` must use the verified domain.
3. **`docs/PRODUCTIONIZE.md`** (new) — an actionable checklist:
   - **Supabase prod swap** *(blocked)* — the unblock condition (Delilah grants org-owner / shares DB password) and the exact `supabase link` → `db push` → Railway `SUPABASE_*` + web `VITE_*` update sequence; cross-reference the handoff. Do it before any real customer data lands.
   - **Custom domain** — Railway custom domains for web + API, the DNS records, and the matching `CORS_ORIGIN` / `VITE_API_URL` / Supabase Auth Site URL updates.
   - **Backups / PITR** — enable in the Supabase dashboard (PITR requires Pro).
   - **Uptime check** — external monitor on `/health`.
   - **Log retention** — Railway + Supabase log settings.
   - **Sentry / error monitoring** — flagged as the next PR-track code cycle (not built here).

## Out of scope / follow-ups (explicit)

- Sentry / error-monitoring integration (next PR-track code cycle).
- Invite-acceptance link + redemption page + token-consume route (new feature; unblocks richer invite email).
- Real Resend domain DNS verification, the Supabase prod swap, custom domain, backups/PITR, uptime — operator/dashboard actions captured in the runbook.
- Per-replica email retry/queue — current `retryInvitation` (operator-triggered) is sufficient for v1.

## Connection to the system

Stays on the established platform spine: the transport plugs into the existing `EmailTransport`/`createEmailService` abstraction (SP-2 onboarding) and the existing invite delivery-status + `retryInvitation` contract; config follows the `loadConfig`/`required` pattern; no change to the RLS/user-JWT data path. The bank-grade standard is honored via zero new dependencies and fail-fast, no-silent-degrade configuration.
