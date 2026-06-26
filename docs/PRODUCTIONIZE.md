# BYB ("Build Your Guild") — Productionize Runbook

The build is staging-deployed and E2E-verified (signup → authed API → RLS query) at
`https://byb-web-production.up.railway.app`. This checklist covers the steps to a real
production environment. Code items have their own spec→plan cycles; the rest are
dashboard / DNS actions.

> **Do the Supabase prod swap before any real customer data lands.** Swapping an empty
> DB is trivial; swapping a populated one is a data migration **and** a privacy event.

Related docs: email delivery is covered end-to-end in [`resend-email-setup.md`](./resend-email-setup.md);
the strategic roadmap and exact project refs are in the bigger-picture handoff
(`~/BYB-bigger-picture-handoff.md`); deploy mechanics are in [`DEPLOY.md`](./DEPLOY.md).

## 1. Supabase production project  *(blocked — external)*
Staging currently runs on a personal Supabase `byb` project. The intended **production**
project is **Delilah's BYB** (Supabase `zoqhmsscpfsngatykuro`, org `hfmgyospmdymoijwjewu`).
Blocked because the operator is a non-owner **member** of that org (the DB password / owner
actions are gated). See the handoff for the exact refs.

- **Unblock:** Delilah resets/shares the DB password **or** makes the operator an org Owner.
- **Then:** `supabase link --project-ref zoqhmsscpfsngatykuro` → `supabase db push`
  → `supabase config push` (carries `[auth.mfa]` + refresh-token rotation) → update the
  Railway `server` env (`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`)
  and the web env (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`) → set the Supabase Auth
  **Site URL** to the web URL.
- Also enable **TOTP MFA** on the cloud project (dashboard → Authentication → MFA, or
  `supabase config push`) — `db push` applies migrations only, not `config.toml`.

## 2. Custom domain (web + API)
- Add Railway custom domains for the **web** and **server** services; create the CNAME
  records Railway shows at your DNS host.
- Update server `CORS_ORIGIN` → the web custom domain, web `VITE_API_URL` → the API custom
  domain (**`VITE_*` is build-time → redeploy web after changing**), and the Supabase Auth
  **Site URL** → the web custom domain.

## 3. Email (Resend)
Covered in full by [`resend-email-setup.md`](./resend-email-setup.md): verify a sending
domain (DNS), set the Supabase Auth SMTP, and set the Express `server` env
(`EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`). The server transport code is
already merged; flipping `EMAIL_PROVIDER=resend` switches it on. The server **fails fast**
at startup if `resend` is selected without a key/from, so invites can't silently fail to send.

## 4. Backups / PITR
Enable backups in the Supabase dashboard (Database → Backups). **Point-in-Time Recovery
requires the Pro plan** — enable it for a money app so recovery isn't limited to daily snapshots.

## 5. Uptime monitoring
Add an external uptime check (e.g. UptimeRobot / Better Uptime) hitting the API `/health`
endpoint (returns `{"status":"ok"}`). Alert on non-200 / latency.

## 6. Log retention
Review Railway log retention on both services and Supabase log settings; retain enough
history for incident review per the bank-grade security standard.

## 7. Error monitoring — Sentry  *(next code cycle)*
Not yet built. Planned as its own spec→plan→build: `@sentry/node` on the server and
`@sentry/react` on the web, gated by a `SENTRY_DSN` env var.

## 8. Pre-go-live security  *(from the security standard)*
- Gate post-setup admin / financial / teammate-invite routes at **AAL2** as they're built
  (onboarding stays AAL1 by design).
- Add self-service **MFA recovery codes** (v1 is operator reset only — see `DEPLOY.md`).
- **Pen-test / threat-model** before real go-live.
- Keep the SCA + gitleaks CI gates green; act on Dependabot PRs.
