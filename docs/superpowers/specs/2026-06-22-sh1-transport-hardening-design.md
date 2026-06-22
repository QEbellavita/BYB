# SH-1 — Server transport/app hardening (design spec)

**Date:** 2026-06-22 · **Status:** approved (brainstorm) → ready for plan
**Sub-project:** Security Hardening track, phase SH-1 (after SH-2 + SH-2.1).

## Goal

Harden the Express API's transport/app layer to the bank-grade standard (memory `byb-security-standard`): security headers, strict CORS allowlist, rate limiting, and request-size limits — **without changing business logic or data access**. This is the "App/server hardening" line item of the security standard.

## Scope

- **In scope:** the Express API only (`server/`). Middleware + `app.ts` wiring + `config.ts` knobs.
- **Out of scope (this phase):** the web SPA's response headers / CSP (the SPA runs on `vite preview`, an interim host; SPA header hardening is a separate small follow-up). Also out: MFA (SH-4), audit log (SH-3), secrets/SCA (SH-5). No business-logic, route-handler, or DB changes.

## Decisions (locked during brainstorm 2026-06-22)

1. **Dependency stance — hybrid.** Hand-roll the security headers (the API is JSON-only, so the header set is small and well-known) and the CORS allowlist, consistent with the existing dependency-free `cors.ts`. Use the vetted **`express-rate-limit`** library for rate limiting (correct rate limiting is easy to get subtly wrong by hand). Net new runtime dependency: `express-rate-limit` only.
2. **Rate-limit store — in-memory + Supabase backstop.** Use express-rate-limit's default in-memory store (no infra). Documented limitation: limits are per-replica. The actual login/brute-force path is SPA→Supabase Auth (not through this API), and Supabase enforces its own auth rate limits as the backstop. Upgradeable to a Postgres/Redis store later.
3. **Surface — server API only** (see Scope).

## Current state (grounding)

`server/src/app.ts` `createApp()` mounts only: `corsMiddleware(CORS_ORIGIN)` → `express.json()` → `healthRouter` → `meRouter` → modules. No security headers, no rate limiting, no explicit body limit, no `trust proxy`, `x-powered-by` exposed. `cors.ts` is dependency-free, single-origin (`CORS_ORIGIN`, defaults `*`), Bearer-token auth (no cookies/credentialed CORS). The API returns JSON only (no HTML).

## Architecture / components

Each unit is small and independently testable (supertest against `createApp`).

### 1. `server/src/middleware/security-headers.ts` (new, hand-rolled)
`securityHeaders(opts?): RequestHandler` setting on every response:
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` — only when `NODE_ENV === 'production'` (browsers ignore HSTS over HTTP; gating avoids surprising local/test behavior).
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` — safe for a JSON API (it loads no resources); defense-in-depth if a response is ever rendered.
- **Not set:** `Cross-Origin-Resource-Policy` — a restrictive value would break the SPA's legitimate cross-origin `fetch`; CORS already governs cross-origin access. (Documented non-choice.)
Plus `app.disable('x-powered-by')` in `app.ts` (removes the Express fingerprint).

### 2. `server/src/middleware/rate-limit.ts` (new, wraps `express-rate-limit`)
Two factory functions, env-tunable, in-memory store, `standardHeaders: true` (emit `RateLimit-*` + `Retry-After`), `legacyHeaders: false`, `429` JSON `{ error: 'too many requests' }`:
- `apiRateLimiter()` — general: window `RATE_LIMIT_WINDOW_MS` (default 60000), max `RATE_LIMIT_MAX` (default 100) per IP. Applied to all `/api` traffic. `/health` is exempt (mounted before it / skipped).
- `strictRateLimiter()` — for expensive/abusable mutations: window 60000, max `RATE_LIMIT_STRICT_MAX` (default 10) per IP. Applied to `POST /api/m/onboarding/workspace`, `POST /api/m/onboarding/finish`, `POST /api/m/onboarding/retry/:id`.
Keyed by `req.ip` (depends on trust proxy below).

### 3. `trust proxy` (in `app.ts`)
`app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1))`. Railway terminates TLS and proxies once, so the client IP is in `X-Forwarded-For`; without this, `req.ip` is the proxy and rate limiting is useless. Documented risk: a value larger than the real proxy hop count lets clients spoof `X-Forwarded-For` to evade limits — `1` matches Railway.

### 4. Request-size limit + parse safety (in `app.ts`)
`express.json({ limit: process.env.BODY_LIMIT ?? '64kb' })` (payloads are small JSON). Add a body-parser error handler so an oversized body → `413 { error: 'request body too large' }` and malformed JSON → `400 { error: 'invalid JSON body' }`, instead of an unhandled `500`.

### 5. CORS allowlist (enhance `server/src/middleware/cors.ts`)
`CORS_ORIGIN` becomes a comma-separated allowlist. The middleware:
- Reads the request `Origin`; if it is in the allowlist, echo it in `Access-Control-Allow-Origin` and set `Vary: Origin`. If not, omit the ACAO header (the browser blocks the response).
- Keeps the existing methods/headers (`Authorization, Content-Type, x-workspace-id`) and `OPTIONS` 204 preflight.
- `*` remains allowed for local dev; emit a `console.warn` once if `CORS_ORIGIN` is `*` (or unset) while `NODE_ENV === 'production'`.
Stays dependency-free. Existing `cors.test.ts` updated for the allowlist behavior.

### 6. Top-level error handler (in `app.ts`, mounted last)
A final `(err, req, res, next)` handler: log server-side, respond `500 { error: 'internal server error' }` with no stack/internal detail. Backstops anything route-level try/catch misses; prevents leaking internals (bank-grade).

### 7. `server/src/config.ts` knobs
Add optional, env-driven config (with the defaults above) for: CORS origins list, rate-limit window/max/strict-max, trust-proxy, body limit. Keep `loadConfig()`'s existing required Supabase vars unchanged.

## Middleware order in `createApp` (after change)
`disable x-powered-by` → `trust proxy` → `securityHeaders()` → `corsMiddleware(allowlist)` → `healthRouter` (exempt from rate limit) → `apiRateLimiter()` → `express.json({limit})` + parse-error handler → `meRouter` → modules (with `strictRateLimiter()` on the named onboarding mutations) → top-level error handler (last).

## Testing (TDD; supertest against `createApp`)
- security-headers: each header present with the expected value; HSTS present only when `NODE_ENV=production`; `x-powered-by` absent.
- rate-limit: `apiRateLimiter` returns `429` after `max` requests within the window; `/health` never throttled; strict limiter trips at its lower max on a strict route.
- cors: an allowlisted `Origin` is echoed (+ `Vary: Origin`); a non-allowlisted `Origin` gets no ACAO; `OPTIONS` → 204.
- body: oversized JSON → `413`; malformed JSON → `400`.
- error handler: a route that throws → `500` generic, no stack in the body.
- Regression: full existing suite stays green (SH-2.1 baseline: 211 server + 78 web + 16 integration).

## Base branch / sequencing
Built on PR #9's branch (`fix/sh2-remediation`) because both modify `app.ts`; this avoids a merge conflict. SH-1's PR targets `main`; once #9 merges, rebase onto `main` so the PR shows only SH-1's diff. New dependency `express-rate-limit` is added to `server/package.json` (pinned).

## Out-of-scope follow-ups (noted, not built here)
- SPA (web) CSP + security headers.
- Per-user (post-auth) rate limiting and a durable (Postgres/Redis) rate-limit store for multi-replica correctness.
- Pre-existing items from the SH-2 review (L1 `isEnabled` oracle, L2 `req.accessToken`) — independent.
