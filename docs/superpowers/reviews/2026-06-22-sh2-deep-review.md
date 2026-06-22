# SH-2 (RLS-as-backstop) — deep whole-branch review

**Date:** 2026-06-22 · **Target:** PR #8 (`sh-2-rls-backstop`), merged to `main` at `8c46d87` (now `448d55a`).
**Method:** 3 independent high-effort Opus reviewers (isolation completeness / test-proof validity / RLS-policy + regressions) against the merged state, + live verification of the top finding on the local stack. This is the deep review the SH-2 handoff flagged as skipped.

## Verdict

**Core thesis of SH-2 holds** for the risk / complaints / improvements / Context-Hub *data* paths: they genuinely run through a per-request user-JWT `userScopedClient`, RLS is enabled with member/admin policies on every one of those tables, and the `anon` role has **no** table grants (so a missing/garbage token fails closed at the ACL layer, not open). The pgTAP suites are **not** running RLS-bypassed — every file applies `set local role authenticated` before asserting (the superuser-psql trap the env note warns about is defended).

**But the review surfaced 1 confirmed Critical + a cluster of HIGH issues. Disposition: fix-forward before stacking more hardening on top.**

---

## Findings (prioritized, deduplicated across reviewers)

### CRITICAL

**C1 — Onboarding `finish` is broken for every tenant (VERIFIED LIVE).**
`app.ts:60` builds `completionStore = supabaseOnboardingCompletionStore(service)` (service-role); `context/onboarding.ts:17` calls `db.rpc('complete_onboarding', …)` with that service-role client and no user token. The RPC (`0012:22`) starts with `if auth.uid() is null then raise exception 'must be authenticated'`. A service-role JWT has no `sub`, so `auth.uid()` is NULL → the RPC raises before doing anything.
*Live proof:* `POST /rest/v1/rpc/complete_onboarding` with the service-role key returns `{"code":"P0001","message":"must be authenticated"}`; `auth.uid()` under service-role claims = NULL.
*Impact:* the onboarding wizard can never complete through the app. Pre-existing from SP-2; **SH-2's design doc explicitly reaffirmed** keeping it service-role ("SECURITY DEFINER … guard auth/admin internally") — backwards: the guard blocks it.
*Fix:* build `completionStore` per-request from `userScopedClient(config, token)` so the user JWT reaches the RPC (`auth.uid()` = real user; the RPC's `is_workspace_admin` then authorizes). The RPC is `grant execute … to authenticated` — designed for the user JWT, not service-role. Add an integration test that drives finish through the real (token-scoped) client so this can't regress silently.

### HIGH

**H1 — `workspaces.ws_insert` policy is `with check (true)`; any authenticated JWT can insert arbitrary `workspaces` rows.**
`0002_rls.sql:18` + `0013` grants INSERT on all tables to `authenticated` → a user can `POST /rest/v1/workspaces` directly, bypassing `create_workspace`. *Not* cross-tenant data exposure (no membership row is created, `ws_select` hides it), but a least-privilege violation enabling orphan-row/DoS and **slug-squatting** (`slug` is `unique`). Contradicts the "RLS is the last line of defense" thesis — it's the one write policy that defends nothing.
*Fix:* `revoke insert on workspaces from authenticated` (force creation through the SECURITY DEFINER RPC), or set `with check (false)`. Add a pgTAP test that a direct workspaces insert is denied.

**H2 — `onboarding_sessions` / `onboarding_invite_drafts` are not behind the RLS backstop (onboardingStore stays service-role).**
`app.ts:124` keeps `onboardingStore` on the service-role client; isolation rests entirely on the app-layer `requireWorkspaceAdmin` gate — the exact regress-scenario SH-2 exists to backstop. Both tables have admin-scoped RLS already (`0011:82-87`), so there's no functional reason. *Not currently exploitable* (the gate validates `workspaceId` via an RLS-backed membership lookup, and `retryInvitation` scopes by server-derived `sessionId`), but a defense-in-depth gap under the bank-grade standard. This is the already-tracked "scope onboardingStore to userScopedClient" follow-up. Converges with the C1 fix.

**H3 — Cross-tenant WRITE denial is untested for 7 tenant tables.**
`context_hub_write_isolation_test.sql` covers only 4 of 8 Hub entity tables; it omits `internal_processes`, `decision_logic`, `risk_frameworks`, `governance`, and the support/audit tables `entity_versions`, `context_events`, `context_links` (these last three are the audit trail — a cross-tenant write there is an audit-integrity breach). They have read-isolation tests only. A future `with check (true)` slip on any of them would pass CI.
*Fix:* extend the write-isolation suite to all 8 entities + add insert/update-denial for the 3 support tables.

**H4 — Two read-isolation suites have no positive control → can pass while broken.**
`context_hub_isolation_test.sql` and `tenant_isolation_test.sql` only assert "tenant A sees 0 of tenant B". If `request.jwt.claims` ever fails to apply (uid → NULL — the *same* failure mode as C1), every count is 0 and all assertions pass while isolation is untested.
*Fix:* add a "tenant sees its own rows (count ≥ 1)" control to each before the cross-tenant zeros.

### MEDIUM

**M1 — Live integration write-denial assertions are effectively dead code.**
`sp3-modules.test.ts`: `rowsInserted` is derived from `.insert()` data which is `null` without `.select()` (always 0); update `count` is null without `{count:…}` (always 0). The explicit denial checks always pass; only the subsequent read-back guards provide real proof. False-confidence trap if anyone "simplifies" the read-backs away.
*Fix:* assert `error` non-null on insert (or `.select()` + check), use `{ count: 'exact' }` on update; keep read-backs as defense-in-depth.

**M2 — Onboarding pgTAP proves RBAC + cross-tenant READ, not cross-tenant WRITE.**
`onboarding_isolation_test.sql`'s 42501 insert-denial is same-tenant staff-vs-admin (RBAC), not a foreign-tenant write. Add a tenant-B-owner insert/update into tenant-A onboarding tables asserting denial.

**M3 — `userScopedClient` doesn't reject an empty/blank token (latent fail-open).**
`supabase.ts:17` sets `Authorization: Bearer ${accessToken}` unconditionally. Safe today (callers are behind `requireAuth`; anon has no grants), but a future route that forgets `requireAuth`, or any future anon grant, turns this into a silent anon query. *Fix:* throw on falsy/blank `accessToken`.

### LOW

- **L1** — Feature-gate `isEnabled` (`app.ts:109`) reads `workspace_features` service-role using the unauthenticated `x-workspace-id` header before `requireAuth` → metadata oracle (module-enabled? for any workspace id). Move after auth or return uniform 401.
- **L2** — Changed routes re-parse the bearer token from the header instead of reusing the validated `req.accessToken` (`require-auth.ts:27`); divergent parsing (`replace(/^Bearer /)` vs `slice(7)`). Use `req.accessToken`.
- **L3** — (pre-existing, not SH-2) complaint `reference` uses a count-based sequence → concurrent creates can collide on the unique constraint and 500.

---

## Verified clean (no action)

- pgTAP suites enforce RLS (correct `set local role authenticated`), not superuser-bypassed.
- No silent-success on converted write paths — stores use `.select().single()`, so RLS denials surface as thrown errors, not false success.
- No per-request client caching / cross-request tenant bleed; per-request client lifecycle is fine (stateless fetch).
- SECURITY DEFINER RPCs `create_workspace` / `redeem_invite` enforce caller identity (no client-supplied id trusted); `complete_onboarding` re-derives admin server-side (its only flaw is C1's caller wiring).
- Event subscriber tenant attribution is correct (workspace_id derived from RLS-written rows).

## Recommended remediation order

1. **C1** (Critical, functional break) — token-thread `completionStore`; converges with **H2** (token-thread `onboardingStore`) — one focused change to the onboarding service factory. + integration test.
2. **H1** — close the `workspaces` direct-insert hole. + pgTAP.
3. **H3 / H4 / M1 / M2** — test-coverage hardening (write-denial for 7 tables, positive controls, fix dead assertions).
4. **M3 / L1 / L2** — small hardening, fold into the above or SH-1.
