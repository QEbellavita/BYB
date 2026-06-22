# Task 4 Report — App-level audit service + authz/auth failure wiring

## TDD RED/GREEN

### RED phase
Wrote two test files **before any implementation**:
- `server/test/audit-service.test.ts` — 4 tests: insert maps fields to snake_case columns; undefined optionals map to null; db promise rejection is swallowed; db error object is swallowed.
- `server/test/audit-middleware-wiring.test.ts` — 9 tests: requireAuth calls recorder on missing-token 401 and invalid-token 401 (with metadata); requireWorkspaceAdmin calls recorder on no-member 403 and staff-role 403 (actor + workspaceId + metadata); both middlewares do NOT call recorder on success; both work without recorder (backward compat).

Ran `npm run test --workspace server -- audit` → **4 failed** (service tests: import failed; middleware wiring tests: recorder never called), 5 passed trivially. Confirmed RED for expected reasons.

### GREEN phase
Implemented in order per brief:
1. `server/src/services/audit.ts` — exports `AuditEvent`, `AuditRecorder`, `createAuditService(db)`.
2. Modified `server/src/middleware/require-auth.ts` — added optional `audit?: AuditRecorder` to `RequireAuthDeps`; both 401 paths fire `void opts.audit?.record(...)`.
3. Modified `server/src/middleware/require-workspace-admin.ts` — added optional `RequireWorkspaceAdminOpts` parameter; both 403 paths fire recorder with action, actor, workspaceId, metadata.
4. Modified `server/src/app.ts` — added `createAuditService(service)` (using the service-role client) and attached it as `audit: auditService` on `authDeps`.

Re-ran tests → **13/13 green** (audit suite), then full suites.

## Middleware signature changes + existing-callers confirmation

### `require-auth.ts`
- `RequireAuthDeps` gains an optional `audit?: AuditRecorder` field.
- `requireAuth({ getUser })` callers pass no `audit` → `audit` is `undefined` → `void undefined?.record(...)` is a no-op. **No existing caller broken.**

### `require-workspace-admin.ts`
- Signature changed from `requireWorkspaceAdmin()` to `requireWorkspaceAdmin(opts?: RequireWorkspaceAdminOpts)`.
- All existing callers in route files (`onboarding/routes.ts`, etc.) call `requireWorkspaceAdmin()` with zero args → `opts` is `undefined` → `void undefined?.audit?.record(...)` is a no-op. **No existing caller broken.**

Confirmed by full server suite: all 35 test files pass including `test/onboarding/routes.test.ts` which has explicit 403-via-requireWorkspaceAdmin assertions.

## Files changed

| File | Change |
|---|---|
| `server/src/services/audit.ts` | NEW — AuditEvent, AuditRecorder, createAuditService |
| `server/src/middleware/require-auth.ts` | +optional audit dep; fire on both 401 paths |
| `server/src/middleware/require-workspace-admin.ts` | +optional opts param; fire on both 403 paths |
| `server/src/app.ts` | +createAuditService(service); +audit on authDeps |
| `server/test/audit-service.test.ts` | NEW — 4 unit tests |
| `server/test/audit-middleware-wiring.test.ts` | NEW — 9 unit tests |

## Test summary

- Server unit: **235 passed** (222 baseline + 13 new) — 0 failed
- Web unit: **78 passed** — 0 failed
- Integration: **16 passed** — 0 failed

## Fix: authz wiring + x-request-id

### Problem
`requireWorkspaceAdmin()` was called bare (no `opts`) at 7 sites in `server/src/modules/onboarding/routes.ts`, so the injected `AuditRecorder` was never passed — `authz.denied` security events never fired in production (only the `requireAuth` 401 path was wired).

### Changes made
| File | Change |
|---|---|
| `server/src/modules/onboarding/routes.ts` | Added `audit?: AuditRecorder` to `OnboardingRouterDeps`; defined `adminGuard = () => requireWorkspaceAdmin({ audit: deps.audit })` helper; replaced all 7 bare `requireWorkspaceAdmin()` calls with `adminGuard()` |
| `server/src/app.ts` | Added `audit: auditService` to `createOnboardingManifest(...)` deps object |
| `server/src/middleware/require-workspace-admin.ts` | Added `requestId: (req.headers['x-request-id'] as string \| undefined) ?? null` to both `record(...)` metadata objects |
| `server/src/middleware/require-auth.ts` | Added `requestId: (req.headers['x-request-id'] as string \| undefined) ?? null` to both `record(...)` metadata objects |
| `server/test/audit-middleware-wiring.test.ts` | Added 2 new tests in `createOnboardingRouter + audit recorder` suite: proves 403 + `authz.denied` fires with correct actor, workspace_id, and `metadata.requestId` when `x-request-id` header is sent; proves admin role does NOT fire `authz.denied` |

### Test results (post-fix)
- Server unit: **237 passed** (235 + 2 new) — 0 failed
- Integration: **16 passed** — 0 failed
- TypeCheck: 4 pre-existing errors in `test/improvements/` (unrelated to this fix; confirmed present on baseline commit)

## Concerns / notes

1. **requireWorkspaceAdmin in route files calls `requireWorkspaceAdmin()` with no audit.** App.ts injects audit into `authDeps` (controlling the `requireAuth` 401 path in production). For `requireWorkspaceAdmin` 403 events, production routes would need the recorder passed through manifest deps. This is deferred to Task 5 or a follow-up refactor; the middleware itself is audit-ready and the unit tests prove correctness.

2. **Fire-and-forget audit calls** use `void recorder.record(...)` — the response is not delayed. `record` swallows errors so there is no risk of an audit failure propagating.

3. **No `actorEmail` on auth.denied events** — per spec §4, auth failures have no actor (token invalid/missing), so actorEmail is intentionally omitted.

4. The service-role client is confirmed to be the `service` variable in app.ts (created by `serviceClient(config)`), consistent with Task 1's INSERT grant to `service_role`.
