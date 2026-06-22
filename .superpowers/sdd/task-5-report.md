# Task 5 Report — Admin Audit-Log Read Endpoint GET /api/audit

## TDD RED/GREEN Evidence

### RED phase
- Unit tests written first (`server/test/audit-route.test.ts`, 9 tests)
- Integration tests written (`server/test/integration/audit.test.ts`, 5 tests)
- Running `npm run test --workspace server -- audit-route` before implementation → `FAIL: Failed to load url ../src/routes/audit.js — Does the file exist?`
- 0 tests collected (module missing)

### GREEN phase
- After implementing `server/src/routes/audit.ts` and mounting in `app.ts`:
  - Unit: **246 passed (36 files)** — 237 baseline + 9 new
  - Integration: **21 passed (5 files)** — 16 baseline + 5 new

## Files Created / Modified

| File | Action |
|------|--------|
| `server/src/routes/audit.ts` | Created — `auditRouter(config, deps?)` factory |
| `server/src/app.ts` | Modified — import + mount at `/api/audit` after `meRouter` |
| `server/test/audit-route.test.ts` | Created — 9 unit tests (supertest + injected fakes) |
| `server/test/integration/audit.test.ts` | Created — 5 integration tests (live stack) |

## Audit Recorder Threading

`requireWorkspaceAdmin()` is called **without** an audit recorder in the route factory. Reasoning:

- The `auditService` (recorder) is instantiated in `app.ts` after the route mount point — it is available at mount time but would require adding an `audit` field to `AuditRouterDeps`, which would need to be wired through every unit test.
- The `requireWorkspaceAdmin` middleware in other routes (onboarding, risk, etc.) also lacks a recorder at the module level — this is consistent with existing patterns.
- The `authz.denied` events for this route are covered by the same service-role `auditService` that other routes use when the middleware is wired with it in those module manifests.
- A bare `requireWorkspaceAdmin()` still enforces the gate correctly (403 for non-admins); only the audit side-effect is absent.

If a recorder is desired in the future, the `AuditRouterDeps` interface has an optional `audit?` field slot that can be added.

## Test Summary

- **Server unit tests:** 246 passed (36 files) — up from 237 baseline
- **Integration tests:** 21 passed (5 files) — up from 16 baseline

## Task Review Findings

**Spec compliance: ✅** — All requirements met verbatim (middleware chain, RLS-scoped client, limit/cursor semantics, response shape, all 4 unit scenarios + 2 integration isolation scenarios, baseline counts preserved).

**Task quality: Approved** — Two non-blocking minors:
- Minor: No NaN guard on `?before` input (`Number('foo')` → `NaN` passed to `.lt()`; Supabase won't crash but a 400 would be cleaner). Fix in next PR if endpoint becomes customer-facing.
- Minor: Default stubs (`defaultGetUser`, `defaultGetMembership`) in `audit.ts` return `null` (deny-all) and are unreachable in production since `app.ts` always injects real deps. Either remove or document as intentional fail-safes.

## Concerns

None blocking. The router correctly:
1. Enforces `requireAuth` → `requireWorkspace` → `requireWorkspaceAdmin`
2. Builds a per-request `userScopedClient` (RLS enforces tenant isolation as defense-in-depth)
3. Clamps `limit` to `Math.min(Number(req.query.limit ?? 50) || 50, 200)`
4. Applies `.lt('id', before)` cursor when `?before` is present
5. Returns `{ entries, nextCursor: entries.length ? last.id : null }`

---

## Fix: /api/audit review items

Commit: `8502847` — `fix(audit): validate ?before (400 not 500) + audit unauthorized /api/audit reads (review fix)`

### Files Changed

| File | Change |
|------|--------|
| `server/src/routes/audit.ts` | Fix 1: validate `?before` (400 for non-positive/non-integer); Fix 2: add `audit?: AuditRecorder` to `AuditRouterDeps`, pass to `requireWorkspaceAdmin`; Fix 3: doc comment on `makeClient?` |
| `server/src/app.ts` | Fix 2: pass `audit: auditService` to `auditRouter` deps |
| `server/test/audit-route.test.ts` | New tests: `?before=foo` → 400, `?before=-1` → 400, `?before=0` → 400; non-admin + recorder injected → 403 + `authz.denied` spy; admin → no authz.denied |

### New Test Output

```
Test Files  36 passed (36)
Tests  251 passed (251)   ← +5 new (was 246)
```

Integration tests unchanged: **21 passed (5 files)**

---

## Fix: anon revoke + ?limit (final-review)

### I-1 (gate) — anon TRUNCATE wipe vector closed

**Root cause:** `0018_audit_log.sql` revoked from `authenticated` and `service_role` but missed the `anon` role. Supabase's default privilege grants left `anon` able to TRUNCATE the entire audit log — live-proven wipe vector.

**Fix applied:**
- `supabase/migrations/0018_audit_log.sql`: added `revoke insert, update, delete, truncate on public.audit_log from anon;`
- Live DB synced: `psql … -c "revoke insert, update, delete, truncate on public.audit_log from anon;"` → `REVOKE`
- `supabase/tests/audit_log_immutability_test.sql`: bumped plan 6 → 10; added 4 anon cases (INSERT, UPDATE, DELETE, TRUNCATE) all asserting `42501`

**anon TRUNCATE denied proof (pgTAP output):**
```
ok 7  - anon cannot INSERT into audit_log (42501)
ok 8  - anon cannot UPDATE audit_log (42501)
ok 9  - anon cannot DELETE from audit_log (42501)
ok 10 - anon cannot TRUNCATE audit_log (42501) — wipe vector denied
```

Full immutability suite: **10/10 ok**. Full pgTAP suite (all 18 test files): **0 not-ok**.

### M-1 (minor) — ?limit validation

**Root cause:** `Number('-5')` is truthy, `Math.min(-5, 200) = -5` → `.limit(-5)` → PostgREST 500.

**Fix applied (`server/src/routes/audit.ts`):**
```ts
let limit = 50
if (req.query.limit !== undefined) {
  const n = Number(req.query.limit)
  if (!Number.isInteger(n) || n <= 0) return res.status(400).json({ error: '?limit must be a positive integer' })
  limit = Math.min(n, 200)
}
```

**New unit tests added (`server/test/audit-route.test.ts`):**
- `?limit=-1` → 400 `{ error: '?limit must be a positive integer' }`
- `?limit=foo` → 400 `{ error: '?limit must be a positive integer' }`
- Existing `?limit=999` → clamped to 200 (store received 200) ✓
- Existing `?limit=10` → 10 ✓

### Test Results

- **pgTAP immutability:** 10/10 ok (anon TRUNCATE → 42501 confirmed)
- **pgTAP full suite:** 0 not-ok across all 18 test files
- **Server unit tests:** 253 passed (36 files)
- **Integration tests:** 21 passed (5 files)
