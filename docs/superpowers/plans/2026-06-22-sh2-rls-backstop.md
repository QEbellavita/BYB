# SH-2 RLS-Backstop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Route all user-input module/Hub data access through a per-request `userScopedClient` so Postgres RLS is the last line of tenant isolation; keep service-role only for the `SECURITY DEFINER` RPCs and the event subscriber. Add cross-tenant write-denial pgTAP.

**Architecture:** `createApp` exposes per-request service factories (`make<Module>Service(token)`) that build the module/Hub/link stores from `userScopedClient(config, token)`. Authed routes resolve the request bearer token and call the factory. App-layer membership/IDOR guards stay (defense in depth). No new migrations.

**Tech Stack:** Node 20+, Express 4, TypeScript strict/ESM, Supabase (Postgres + RLS), Vitest + Supertest, pgTAP.

## Global Constraints
- User-input table access uses `userScopedClient(config, accessToken)`; app-layer guards remain.
- Service-role retained + documented ONLY for: `create_workspace`/`redeem_invite`/`complete_onboarding` RPCs, and the event `publish` + improvement subscriber (system, event-derived, scoped by `event.workspace_id`).
- RLS on every tenant table stays keyed on `public.is_workspace_member(workspace_id)`. No new migrations.
- pgTAP locally via psql `postgresql://postgres:postgres@127.0.0.1:54332/postgres` (the `supabase test db` CLI is broken locally; CI uses the real gate). The CI workflow now also runs `npm run build` (server+web) — keep it green.
- TS strict + ESM (`.js` local imports). Conventional commits on `sh-2-rls-backstop`. Run `npm install` once in the worktree before building.

## Reference
`server/src/app.ts` (current singleton wiring + the `bootstrapRouter`/`createWorkspaceAction` which already use `userScopedClient`), `server/src/supabase.ts` (`userScopedClient`), and the module routers (`server/src/modules/*/routes.ts`, `manifest.ts`). Stores already take a `SupabaseClient` — only the client passed changes.

---

### Task 1: Per-request user-scoped factory for the risk module (establish the pattern)
**Files:** Modify `server/src/app.ts`, `server/src/modules/risk/routes.ts`, `server/src/modules/risk/manifest.ts`; Test `server/test/risk/routes.test.ts`.
**Interfaces:** Produces a router-deps shape that takes `makeService: (token: string) => RiskService` instead of a singleton `service`; the route derives `token` from the `Authorization` header and calls `makeService(token)`.

- [ ] **Step 1: Write the failing test** — extend `routes.test.ts` to assert the router calls its `makeService` factory with the request's bearer token (inject a fake factory that records the token; assert it received the test's `Bearer <token>`), and that a normal list/create still returns 200/201 through the factory-produced (fake) service.
- [ ] **Step 2: Run it, verify RED** — `npm run test:server -- --run test/risk/routes.test.ts` (factory param doesn't exist yet).
- [ ] **Step 3: Implement** — change `createRiskRouter`/manifest deps from `service: RiskService` to `makeService: (token: string) => RiskService`; in each handler resolve `const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')` and `const service = makeService(token)`. In `app.ts`, define `makeRiskService = (token: string) => createRiskService({ hub: ContextHub, hubStore: supabaseHubStore(userScopedClient(config, token)), store: supabaseRiskStore(userScopedClient(config, token)), publish, links, linkStore: supabaseLinkStore(userScopedClient(config, token)) })` and pass it to the risk manifest. (`publish` stays the shared service-role one.)
- [ ] **Step 4: Verify GREEN** — focused test, then `npm run test:server`, then `npm run build --workspace server`.
- [ ] **Step 5: Commit** — `git commit -m "refactor: risk module uses per-request userScopedClient (RLS backstop)"`.

### Task 2: Apply the factory to complaints, improvements, and onboarding Hub-step writes
**Files:** Modify `server/src/app.ts`, `server/src/modules/{complaints,improvements,onboarding}/routes.ts` + `manifest.ts`; Tests: the respective `routes.test.ts`.
**Interfaces:** Each module router takes `makeService: (token) => Service`; onboarding's per-step Hub writes (saveProfile/saveRules/saveIndustry/savePeople) use a `userScopedClient`-backed Hub store. The `complete_onboarding` call (completionStore) STAYS service-role; `create_workspace`/bootstrap already user-scoped.
- [ ] **Step 1** Write failing route tests for complaints + improvements (factory called with the bearer token), mirroring Task 1.
- [ ] **Step 2** RED.
- [ ] **Step 3** Implement the factories in `app.ts` (`makeComplaintsService`, `makeImprovementsService`, onboarding service factory for Hub-step writes) using `userScopedClient(config, token)` stores; wire into each manifest. Keep `completionStore` + the improvement subscriber on service-role; add a one-line comment at each service-role use stating why.
- [ ] **Step 4** GREEN — focused tests, full `npm run test:server`, `npm run build --workspace server`.
- [ ] **Step 5** Commit — `refactor: complaints/improvements/onboarding use per-request userScopedClient`.

### Task 3: Cross-tenant write-denial pgTAP for all tenant tables
**Files:** add write-denial assertions to `supabase/tests/{risk_entries,complaints,improvements,onboarding}_isolation_test.sql` (and the Hub entity tables touched by user CRUD: business_profile, business_rules, org_people, compliance_obligations) or new `*_write_isolation_test.sql`.
**Interfaces:** under a foreign workspace's JWT (`set local role authenticated` + claims), an `insert`/`update` into another workspace's rows is denied (RLS `with check`).
- [ ] **Step 1** Write the failing assertions — e.g. `select throws_ok($$ insert into risk_entries(workspace_id,title,likelihood,impact) values('<other-ws>','x',1,1) $$, '42501', null, 'foreign member cannot insert into another workspace')` under the foreign JWT (note: RLS `with check` violation surfaces as error code `42501`). Add one insert-denial + one update-denial per table. Bump each file's `plan(N)`.
- [ ] **Step 2** Run via psql, verify the new assertions pass (RLS already enforces `with check`) — `npm run db:reset` then the psql loop. (These should pass immediately since policies exist; if any table's policy lacks `with check`, that is a real finding — fix the policy in a migration.)
- [ ] **Step 3** Commit — `test: cross-tenant write-denial pgTAP for all tenant tables`.

### Task 4: Extend the live integration test for cross-tenant write denial via scoped clients
**Files:** Modify `server/test/integration/sp3-modules.test.ts`.
**Interfaces:** a second tenant's `userScopedClient` (real JWT) cannot READ or WRITE the first tenant's risk/complaint/improvement rows.
- [ ] **Step 1** Add assertions: using tenant 2's JWT-scoped client, attempt to `insert`/`update` a risk + complaint in tenant 1's workspace → the operation is denied (error or zero rows affected) and tenant 1's data is unchanged. (Read-denial already covered.)
- [ ] **Step 2** Run `npm run db:reset && npm run test:int --workspace server` → all pass.
- [ ] **Step 3** Commit — `test: live cross-tenant write-denial via user-scoped clients`.

### Task 5: Final scope/security verification
- [ ] **Step 1** `rg -n "serviceClient\(|service\)" server/src/app.ts` and confirm every remaining service-role use is one of the documented exceptions (RPCs, publish/subscriber, isEnabled) — each with an explanatory comment.
- [ ] **Step 2** Full matrix: `npm run db:reset`; pgTAP psql loop (0 not-ok); `npm test`; `npm run build --workspace server` + `--workspace web` (no stray `.js`); `npm run test:int --workspace server`; `git diff --check`.
- [ ] **Step 3** If anything changed a file, return to its task, rerun its focused test, amend. If clean, no commit.

## Self-review notes
- Spec coverage: factory threading (T1–T2), service-role exceptions documented (T2/T5), write-denial pgTAP (T3) + live (T4), verification (T5). ✓
- The only thing that could surface a real defect is a table whose RLS policy lacks `with check` (T3 would catch it) — fix via migration if found.
