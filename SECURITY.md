# Security Policy

Build the Guild ("BtG", code identifiers `byb`) is an Australian fintech application that handles money, personal information (PII), payments (Stripe), accounting integrations (Xero/MYOB), and customers' bank-account data (CDR / Open Banking). It is built to a bank-grade standard.

## Reporting a vulnerability

Please report security issues **privately** — do not open a public GitHub issue. Email the maintainer (or use a private channel) with details and reproduction steps. We aim to acknowledge within a few business days.

## Secret handling

- **No secrets in the repository.** Credentials live only in environment variables, never committed. `.env` / `.env.local` are gitignored; `.env.example` contains placeholders only.
- **`SUPABASE_SERVICE_ROLE_KEY` is a master key** (full database access, bypasses RLS for grants). It is set **only on the server service**, never exposed to the browser/web bundle. The web app uses only the `anon` (public) key + the user's JWT.
- **Local demo keys never reach production.** The Supabase local-development anon/service_role keys are well-known public values; a real Supabase Cloud project issues its own keys, which are the only ones used in production.
- **Rotate before go-live** and on any suspected exposure. Production secrets are managed via the host's secret store (Railway service variables / Supabase dashboard).
- Secrets are sent between people over a private channel (Signal / 1Password), never email or group chat.

## Automated checks (CI gates, `.github/workflows/ci.yml`)

- **Secret scanning** — `gitleaks` runs on every pull request and push, scanning the full history; any finding fails the build. Config: `.gitleaks.toml`.
- **Dependency / SCA gate** — `npm audit --omit=dev --audit-level=high` fails the build on **high or critical** vulnerabilities in **production** dependencies (the deployed attack surface). Development/build tooling (vite/vitest/esbuild) is excluded — it ships in no runtime artifact — and is tracked separately by Dependabot.
- **Dependency updates** — Dependabot opens weekly update PRs for npm dependencies and GitHub Actions (`.github/dependabot.yml`).
- The existing gates also run: unit tests, server + web builds, and the pgTAP RLS-isolation suite.

## Layered application security (implemented)

- **Tenant isolation** — Postgres Row-Level Security is the last line of defense; all user-scoped reads/writes run under the user's JWT (`userScopedClient`) so RLS enforces isolation even if app-layer checks regress (SH-2 / SH-2.1).
- **Transport hardening** — security headers (CSP/HSTS/nosniff/X-Frame-Options), a strict CORS allowlist, rate limiting, and request-size limits (SH-1).
- **Audit** — an append-only, immutable `audit_log` (REVOKE-enforced, admin-only RLS reads) records data changes and auth/authz events (SH-3).
- **MFA** — TOTP multi-factor auth via Supabase; sensitive routes require an MFA-verified (AAL2) session (SH-4).

## Compliance (scoping — separate track)

In scope as the product matures: Privacy Act 1988 / Australian Privacy Principles; PCI-DSS minimised via Stripe hosted/Elements (no raw card data); Xero/MYOB OAuth token security; and CDR / Open Banking accreditation (ACCC Accredited Data Recipient, or an accredited intermediary such as Basiq/Frollo) before accessing customers' bank-account data.
