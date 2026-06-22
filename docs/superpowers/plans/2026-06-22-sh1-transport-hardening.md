# SH-1 Transport/App Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the Express API transport layer — security headers, strict CORS allowlist, rate limiting, request-size limits — with no business-logic or data-access changes. (Spec: `docs/superpowers/specs/2026-06-22-sh1-transport-hardening-design.md`.)

**Architecture:** Hand-rolled, dependency-free middleware for headers and CORS (matching the existing `cors.ts`); the vetted `express-rate-limit` library (in-memory store) for rate limiting. Wired in `server/src/app.ts`; env knobs in `server/src/config.ts`.

**Tech Stack:** Node 22+, Express 4, TypeScript strict/ESM (`.js` import specifiers), Vitest + Supertest.

## Global Constraints

- **Bank-grade** (memory `byb-security-standard`): security gates the merge; no leaking internals; least privilege.
- **Hybrid deps:** hand-roll headers + CORS; use `express-rate-limit` (the ONLY new runtime dep) for rate limiting. Do not add helmet or other deps.
- **Server API only.** No web/SPA changes. No route-handler business logic or DB changes (except adding the strict limiter middleware to 3 onboarding routes).
- **ESM:** import specifiers end in `.js` even for `.ts` files.
- **Rate-limit store:** in-memory (express-rate-limit default). Per-replica limitation is accepted and documented.
- Modules mount at `/api/m/<id>`. Onboarding strict-limited routes: `POST /api/m/onboarding/workspace`, `/finish`, `/retry/:id`.
- Tests: `npm run test --workspace server -- <pattern>` (focused); `npm test` (full). Baseline must stay green: **211 server + 78 web + 16 integration** (integration via `npm run test:int --workspace server`, local stack running).
- Commit after each task. Do NOT push (controller handles the PR).

---

### Task 1: Security headers middleware

**Files:**
- Create: `server/src/middleware/security-headers.ts`
- Modify: `server/src/app.ts` (disable `x-powered-by`; mount `securityHeaders()` first)
- Test: `server/test/security-headers.test.ts`

**Interfaces:**
- **Produces:** `securityHeaders(): import('express').RequestHandler`

- [ ] **Step 1: Write the failing test.**

`server/test/security-headers.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'

afterEach(() => { delete process.env.NODE_ENV })

describe('security headers', () => {
  it('sets baseline security headers and hides x-powered-by', async () => {
    const res = await request(createApp()).get('/health')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'")
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
  it('sets HSTS only in production', async () => {
    const dev = await request(createApp()).get('/health')
    expect(dev.headers['strict-transport-security']).toBeUndefined()
    process.env.NODE_ENV = 'production'
    const prod = await request(createApp()).get('/health')
    expect(prod.headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains; preload')
  })
})
```

- [ ] **Step 2: Run — verify RED.**
Run: `npm run test --workspace server -- security-headers`
Expected: FAIL (headers absent; `x-powered-by` present).

- [ ] **Step 3: Implement the middleware.**

`server/src/middleware/security-headers.ts`:
```ts
import type { RequestHandler } from 'express'

/**
 * Hand-rolled security headers for the JSON API (dependency-free, like cors.ts).
 * HSTS is only honoured over HTTPS and is gated to production to avoid surprising
 * local/test behaviour. CORP is intentionally NOT set — it would break the SPA's
 * legitimate cross-origin fetch; CORS governs cross-origin access.
 */
export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
    }
    next()
  }
}
```

- [ ] **Step 4: Wire into `app.ts`.**
At the top of `createApp`, immediately after `const app = express()`:
```ts
  app.disable('x-powered-by')
  app.use(securityHeaders())
```
(Add `import { securityHeaders } from './middleware/security-headers.js'`.) Place `securityHeaders()` before `corsMiddleware(...)`.

- [ ] **Step 5: Run — verify GREEN.**
Run: `npm run test --workspace server -- security-headers` → PASS.

- [ ] **Step 6: Commit.**
```bash
git add -A && git commit -m "feat(sec): security headers middleware + drop x-powered-by (SH-1)"
```

---

### Task 2: Strict CORS allowlist

**Files:**
- Modify: `server/src/middleware/cors.ts` (allowlist + echo origin + Vary + prod warn)
- Modify: `server/test/cors.test.ts` (allowlist behavior)
- Modify: `server/src/app.ts` only if the call signature changes (it stays `corsMiddleware(process.env.CORS_ORIGIN)`)

**Interfaces:**
- `corsMiddleware(originSpec?: string): RequestHandler` — `originSpec` is the raw `CORS_ORIGIN` value, a comma-separated allowlist (or `*`, or undefined → `*`).

- [ ] **Step 1: Read the current `cors.test.ts` and `cors.ts`** so you preserve existing covered behavior (methods, allowed headers, OPTIONS 204).

- [ ] **Step 2: Write/extend failing tests** in `server/test/cors.test.ts`:
```ts
// allowlist: request Origin in the list is echoed + Vary: Origin
it('echoes an allow-listed origin and sets Vary', async () => {
  const app = makeApp('https://a.example.com,https://b.example.com')
  const res = await request(app).get('/t').set('Origin', 'https://b.example.com')
  expect(res.headers['access-control-allow-origin']).toBe('https://b.example.com')
  expect(res.headers['vary']).toMatch(/Origin/)
})
it('omits ACAO for a non-allow-listed origin', async () => {
  const app = makeApp('https://a.example.com')
  const res = await request(app).get('/t').set('Origin', 'https://evil.example.com')
  expect(res.headers['access-control-allow-origin']).toBeUndefined()
})
it('still answers OPTIONS preflight with 204', async () => {
  const app = makeApp('https://a.example.com')
  const res = await request(app).options('/t').set('Origin', 'https://a.example.com')
  expect(res.status).toBe(204)
})
```
(Use the existing test's `makeApp` helper pattern — a tiny express app mounting `corsMiddleware(spec)` + a `/t` route. Match the file's existing style; keep the existing `*`-default and headers assertions.)

- [ ] **Step 3: Run — verify RED.** `npm run test --workspace server -- cors` → the new allowlist cases FAIL (current code sets a single fixed origin, no echo).

- [ ] **Step 4: Implement the allowlist** in `cors.ts`:
```ts
import type { RequestHandler } from 'express'

export function corsMiddleware(originSpec = '*'): RequestHandler {
  const allowList = originSpec.split(',').map((s) => s.trim()).filter(Boolean)
  const allowAll = allowList.length === 0 || allowList.includes('*')
  if (allowAll && process.env.NODE_ENV === 'production') {
    console.warn('[cors] CORS_ORIGIN is "*" (or unset) in production — set an explicit allowlist')
  }
  return (req, res, next) => {
    const origin = req.headers.origin
    if (allowAll) {
      res.header('Access-Control-Allow-Origin', '*')
    } else if (origin && allowList.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin)
      res.header('Vary', 'Origin')
    }
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-workspace-id')
    res.header('Access-Control-Max-Age', '86400')
    if (req.method === 'OPTIONS') { res.sendStatus(204); return }
    next()
  }
}
```

- [ ] **Step 5: Run — verify GREEN.** `npm run test --workspace server -- cors` → PASS (new + existing).

- [ ] **Step 6: Commit.**
```bash
git add -A && git commit -m "feat(sec): CORS allowlist (multi-origin echo + Vary, prod warn) (SH-1)"
```

---

### Task 3: Request-size limit + JSON parse safety + top-level error handler

**Files:**
- Modify: `server/src/app.ts` (`express.json({ limit })`, parse-error handler, final error handler)
- Modify: `server/src/config.ts` (no required-var change; the body limit is read from env inline in app.ts — no config change strictly needed)
- Test: `server/test/error-handling.test.ts`

**Interfaces:**
- Body limit from `process.env.BODY_LIMIT ?? '64kb'`.

- [ ] **Step 1: Write the failing test** `server/test/error-handling.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'

describe('request hardening', () => {
  it('rejects malformed JSON with 400 (not 500)', async () => {
    const res = await request(createApp())
      .post('/api/me').set('Content-Type', 'application/json').send('{bad json')
    expect(res.status).toBe(400)
  })
  it('rejects an oversized body with 413', async () => {
    process.env.BODY_LIMIT = '1kb'
    const big = JSON.stringify({ x: 'a'.repeat(5000) })
    const res = await request(createApp())
      .post('/api/me').set('Content-Type', 'application/json').send(big)
    expect(res.status).toBe(413)
    delete process.env.BODY_LIMIT
  })
})
```
(Use a POST to any always-mounted route that parses JSON. If `/api/me` is GET-only, use the body-parser path: a POST to any path still triggers `express.json()` before routing, so the parse/size error fires regardless of a matching route. Pick a path that reaches `express.json()`; confirm by reading `meRouter`/route mounts. If no POST route is reachable without `config`, call `createApp(testConfig)` or assert the error on a 404 path that still parses the body — the body parser runs app-wide before routing.)

- [ ] **Step 2: Run — verify RED.** `npm run test --workspace server -- error-handling` → malformed JSON currently yields 400 from express's default body-parser error *only if* an error handler formats it; without a handler express returns a 400 HTML or 500. Confirm the actual current behavior in the RED run and adjust the implementation to guarantee JSON 400/413.

- [ ] **Step 3: Implement.** In `app.ts`: change `app.use(express.json())` → `app.use(express.json({ limit: process.env.BODY_LIMIT ?? '64kb' }))`. Immediately after, add a body-parser error handler:
```ts
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err && err.type === 'entity.too.large') { res.status(413).json({ error: 'request body too large' }); return }
    if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) { res.status(400).json({ error: 'invalid JSON body' }); return }
    next(err)
  })
```
And at the very END of `createApp` (after all routes/modules), a final error handler:
```ts
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled error:', err)
    res.status(500).json({ error: 'internal server error' })
  })
```
(Return `app` after this.)

- [ ] **Step 4: Run — verify GREEN** and run the full server suite to ensure the new body limit doesn't reject legitimate payloads (`npm run test --workspace server`). If any existing test posts >64kb, raise the default or scope the limit — report if so.

- [ ] **Step 5: Commit.**
```bash
git add -A && git commit -m "feat(sec): explicit body-size limit + JSON parse 400/413 + generic 500 handler (SH-1)"
```

---

### Task 4: Rate limiting + trust proxy

**Files:**
- Modify: `server/package.json` (add `express-rate-limit`)
- Create: `server/src/middleware/rate-limit.ts`
- Modify: `server/src/app.ts` (`trust proxy`; mount `apiRateLimiter()` after `healthRouter`)
- Modify: `server/src/modules/onboarding/routes.ts` (apply a shared strict limiter to the 3 sensitive routes)
- Test: `server/test/rate-limit.test.ts`

**Interfaces:**
- **Produces:** `apiRateLimiter(overrides?): RequestHandler`, `strictRateLimiter(overrides?): RequestHandler` (overrides merge over env/defaults so tests can set a tiny `limit`).

- [ ] **Step 1: Add the dependency.**
Run: `npm install express-rate-limit --workspace server` (pins a v7 version in `server/package.json`). Confirm the installed major is 7 and the API is `import rateLimit from 'express-rate-limit'` with `{ windowMs, limit, standardHeaders, legacyHeaders, handler }`.

- [ ] **Step 2: Write the failing test** `server/test/rate-limit.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { apiRateLimiter } from '../src/middleware/rate-limit.js'

function appWith(limit: number) {
  const app = express()
  app.use(apiRateLimiter({ windowMs: 60_000, limit }))
  app.get('/t', (_req, res) => res.json({ ok: true }))
  return app
}

describe('apiRateLimiter', () => {
  it('returns 429 after the limit is exceeded', async () => {
    const app = appWith(2)
    expect((await request(app).get('/t')).status).toBe(200)
    expect((await request(app).get('/t')).status).toBe(200)
    const third = await request(app).get('/t')
    expect(third.status).toBe(429)
    expect(third.headers['retry-after']).toBeDefined()
  })
})
```
(Also add a test that `strictRateLimiter({ limit: 1 })` trips on the 2nd request.)

- [ ] **Step 3: Run — verify RED.** `npm run test --workspace server -- rate-limit` → FAIL (module/function not found).

- [ ] **Step 4: Implement** `server/src/middleware/rate-limit.ts`:
```ts
import rateLimit, { type Options } from 'express-rate-limit'
import type { RequestHandler } from 'express'

const num = (v: string | undefined, d: number) => (v ? Number(v) : d)

const base = (limit: number, windowMs: number, overrides?: Partial<Options>): RequestHandler =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too many requests' },
    ...overrides,
  })

export function apiRateLimiter(overrides?: Partial<Options>): RequestHandler {
  return base(num(process.env.RATE_LIMIT_MAX, 100), num(process.env.RATE_LIMIT_WINDOW_MS, 60_000), overrides)
}

export function strictRateLimiter(overrides?: Partial<Options>): RequestHandler {
  return base(num(process.env.RATE_LIMIT_STRICT_MAX, 10), num(process.env.RATE_LIMIT_WINDOW_MS, 60_000), overrides)
}
```

- [ ] **Step 5: Wire trust proxy + general limiter in `app.ts`.**
After `const app = express()` (with the Task 1 lines): `app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1))`.
Mount the general limiter AFTER `app.use(healthRouter)` so `/health` is exempt: `app.use(apiRateLimiter())`.
(Add `import { apiRateLimiter } from './middleware/rate-limit.js'`.)

- [ ] **Step 6: Apply the strict limiter to onboarding mutations** in `server/src/modules/onboarding/routes.ts`.
At the top of `createOnboardingRouter`, create one shared instance: `const strict = strictRateLimiter()` (import it). Add `strict` as the FIRST middleware on the three routes:
`router.post('/workspace', strict, requireAuth(auth), ...)`,
`router.post('/finish', strict, ...authWs(), requireWorkspaceAdmin(), ...)`,
`router.post('/retry/:id', strict, ...authWs(), requireWorkspaceAdmin(), ...)`.

- [ ] **Step 7: Run — verify GREEN.** `npm run test --workspace server -- rate-limit` → PASS.

- [ ] **Step 8: Full regression.** `npm test && npm run test:int --workspace server`.
Expected: all green (server unit 211 + new tests; web 78; integration 16). Watch for: an existing test that fires >100 requests through `createApp` and now hits the limiter — if so, scope or raise the limit and report. Confirm `app.set('trust proxy', 1)` doesn't trigger express-rate-limit's permissive-trust-proxy validation error (1 is fine; `true` is not).

- [ ] **Step 9: Commit.**
```bash
git add -A && git commit -m "feat(sec): rate limiting (general + strict) + trust proxy (SH-1)"
```

---

## Self-Review notes
- **Spec coverage:** headers → T1; CORS allowlist → T2; body limit + parse safety + error handler → T3; rate limiting + trust proxy + dep → T4. All spec components covered.
- **Type consistency:** `apiRateLimiter`/`strictRateLimiter` defined in T4 (rate-limit.ts) and consumed in T4 (app.ts, onboarding routes). `securityHeaders`/`corsMiddleware` signatures consistent across tasks.
- **Order:** independent; run 1→2→3→4 sequentially. Each ends with a committed, tested deliverable. T4 is last because it adds the dep and touches a module route.
