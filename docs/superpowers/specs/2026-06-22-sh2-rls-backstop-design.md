# SH-2 — RLS as the Tenant-Isolation Backstop (Design)

**Status:** approved (brainstorm 2026-06-22)
**Part of:** the Security Hardening track (SH-1 transport · **SH-2 RLS backstop** · SH-3 audit · SH-4 MFA · SH-5 secrets/SCA · compliance track). This is the first phase, per the bank-grade security standard for an app handling AU financial/banking + PII data.
**Depends on:** SP-0/1/2/3 (all merged to main). **Branch/worktree:** `sh-2-rls-backstop` in `/private/tmp/byb-sh2`.

## Goal

Make Postgres **RLS the last line of defense** for tenant isolation of financial/PII data. Today, user-data reads/writes in the onboarding (SP-2) and risk/complaints/improvements (SP-3) modules run through the **service-role** Supabase client, which bypasses RLS — isolation rests only on app-layer membership + IDOR checks. SH-2 routes all user-input-driven table access through a per-request **`userScopedClient`** (the caller's JWT), so RLS enforces isolation even if an app-layer guard regresses. The app-layer guards stay (defense in depth).

## Global Constraints

- No behavior change for legitimate users; every existing test stays green.
- User-input-driven table access (module CRUD + onboarding Hub-step writes) uses `userScopedClient(config, accessToken)`. The app-layer membership/IDOR guards remain.
- Service-role is RETAINED, and each use documented in-code, ONLY for genuinely-system paths:
  - the `SECURITY DEFINER` RPCs `create_workspace`, `redeem_invite`, `complete_onboarding` (already auth/admin-guarded internally), and
  - the event `publish` + improvement **subscriber** (system process reacting to events; no user input; writes only event-derived improvement rows scoped by `event.workspace_id`).
- RLS on every tenant table stays keyed on `public.is_workspace_member(workspace_id)`; add cross-tenant **write**-denial pgTAP to complement existing read-denial.
- TypeScript strict + ESM (`.js` local imports). Conventional commits on `sh-2-rls-backstop`. No new migrations (policies already exist).

## Approach — per-request service factory

`createApp(config)` currently builds singleton service-role stores/services once. SH-2 changes the wiring so authed routes get a service bound to the request's user JWT:

- Add per-request factories in `createApp`, e.g. `makeRiskService(token)`, `makeComplaintsService(token)`, `makeImprovementsService(token)`, and an onboarding service factory for its Hub-step writes. Each builds the Hub/module/link stores from `userScopedClient(config, token)` and wires the SAME shared `publish` (publish itself stays service-role for the outbox/dispatch — see below).
- Each authed route resolves the request bearer token (already available behind `requireAuth`/`authedWorkspaceRoute`; see the existing bootstrap route which already derives it) and calls the factory, then invokes the service method. The route's existing `requireWorkspace`/`requirePermission`/IDOR guards are unchanged.
- The factory pattern mirrors the existing `bootstrapRouter`/`createWorkspaceAction`, which already use `userScopedClient`.

### What stays service-role (and why)
- `completionStore` → `complete_onboarding` RPC; `create_workspace`/`redeem_invite` RPCs — `SECURITY DEFINER`, run elevated by design, guard auth/admin internally.
- `publish` + `dispatchPendingEvents` + the improvement subscriber's stores — a server-side system reaction to already-authorized writes, scoped by `event.workspace_id`, with no user-supplied row data beyond what the event carries. (Converting the global event dispatcher to per-user scoping is the dispatcher follow-up tracked in the SH backlog — out of scope here.)
- `isEnabled` (feature-registry lookup of `workspace_features`) — a config-flag read, not tenant data; may stay service-role. (Optional: scope it too; low priority.)

## Affected code (no new files expected beyond tests)
- `server/src/app.ts` — replace singleton service-role module stores/services with per-request factories built on `userScopedClient`; keep the service-role wiring only for the RPC/subscriber paths above.
- `server/src/modules/{risk,complaints,improvements}/routes.ts` and `server/src/modules/onboarding/routes.ts` — resolve the request token and call the factory (the module router deps gain a service-factory instead of a singleton service).
- The module manifests' router deps — accept a `(token) => Service` factory.
- Stores (`supabaseHubStore`, `supabaseOnboardingStore`, the SP-3 `supabase-store`s, `supabaseLinkStore`) are unchanged — they already take a `SupabaseClient`; we just pass the scoped one.

## Tests (the security proof)
- **pgTAP cross-tenant write-denial** on every tenant table (workspaces' module tables + Hub entity tables touched by user CRUD): under a foreign workspace's JWT, an `insert`/`update` into another workspace's rows is denied (RLS `with check`), via `throws_ok`/zero-rows-affected. Add to each `*_isolation_test.sql` (or a new `*_write_isolation_test.sql`).
- **Live integration**: extend `sp3-modules.test.ts` (and/or onboarding) so a second tenant's `userScopedClient` cannot READ or WRITE the first tenant's risk/complaint/improvement/profile rows — proving the backstop end-to-end through the real scoped path.
- Existing unit tests (with fakes) stay green; route tests still pass (factory returns the same service interface).

## Verification matrix (all green before merge)
`npm run db:reset`; pgTAP via psql (0 not-ok); `npm test` (server+web); both builds; `find web/src web/test -name '*.js'` empty; `npm run test:int --workspace server`; `git diff --check`. CI green on the PR.

## Out of scope (other SH phases / tracked)
SH-1 transport (helmet/rate-limit/CORS), SH-3 audit log + created_by FKs, SH-4 MFA, SH-5 secrets/SCA, the CDR/compliance track, and converting the global event dispatcher to per-user scoping.

## Build order (≈4–5 TDD tasks)
1. Add the per-request user-scoped service factory wiring for ONE module (risk) end-to-end (app.ts + routes + route-test proving a scoped client is used) — establishes the pattern.
2. Apply the factory to complaints + improvements + onboarding Hub-step writes.
3. Add cross-tenant write-denial pgTAP across all tenant tables.
4. Extend the live integration test for cross-tenant write denial via scoped clients.
5. Final scope/security verification + full matrix.
