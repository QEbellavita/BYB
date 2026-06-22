# SH-2.1 Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the findings from the SH-2 deep review (`docs/superpowers/reviews/2026-06-22-sh2-deep-review.md`): unbreak onboarding `finish`, make RLS the genuine backstop for onboarding tables, close the `workspaces` direct-insert hole, and harden the isolation test suite.

**Architecture:** The app already uses a per-request `userScopedClient(config, token)` pattern (user JWT → Postgres RLS) for risk/complaints/improvements/Hub data. This plan extends that same pattern to the onboarding service + router, adds a migration to deny direct `workspaces` INSERT by `authenticated`, and fills test gaps in the pgTAP isolation suites.

**Tech Stack:** Node/Express (ESM, `.js` import specifiers), TypeScript, Vitest + supertest, Supabase (Postgres + RLS), pgTAP.

## Global Constraints

- **Bank-grade security standard** (memory `byb-security-standard`): RLS is the LAST line of defense; no service-role for user-scoped data; security gates the merge.
- **ESM imports** use `.js` specifiers even for `.ts` files (e.g. `import { x } from './foo.js'`).
- **Local stack is running** on ports 54331 (API) / 54332 (DB). Service/anon keys are in the worktree's gitignored `.env` (already written).
- **pgTAP runner:** the `supabase test db` CLI is broken here (Files=0). Run pgTAP via psql:
  `psql postgresql://postgres:postgres@127.0.0.1:54332/postgres -f <file>` — output must show all `ok`, no `not ok`, and the final plan count.
- **Integration tests:** `npm run test:int --workspace server` (uses `--env-file=../.env`, hits the live stack).
- **Unit tests:** `npm test` (server excludes `test/integration/**`, then web).
- **Module routes** require BOTH headers: `Authorization: Bearer <jwt>` and `x-workspace-id: <uuid>`. `POST /api/m/onboarding/workspace` is gate-exempt (auth only).
- After every task: run the full unit + integration suite and confirm no regressions (baseline = 208 server + 78 web + 15 integration).
- Commit after each task with a descriptive message. Do NOT push (the orchestrator handles the PR).

---

### Task 1: Onboarding service + router use per-request `userScopedClient` (fixes C1 + H2)

**Why:** `app.ts` builds `completionStore` and `onboardingStore` from the **service-role** client. `complete_onboarding` (0012:22) requires `auth.uid()` (NULL under service-role) → onboarding `finish` raises `"must be authenticated"` for every tenant (verified live). The onboarding router also reads/writes `onboarding_sessions`/`onboarding_invite_drafts` via the service-role store, bypassing RLS. Fix: thread the user JWT through both.

**Files:**
- Modify: `server/src/app.ts` (the onboarding wiring block, ~lines 59-61, 121-143, 208-214)
- Modify: `server/src/modules/onboarding/routes.ts` (deps interface + handlers)
- Modify: `server/src/modules/onboarding/manifest.ts` (deps pass-through types only if needed)
- Possibly remove dead global: `server/src/context/index.ts` (`setOnboardingStore` / `ContextHub.onboarding`) — only if grep shows it unused
- Test (new): `server/test/integration/onboarding-finish-wiring.test.ts`

**Interfaces:**
- `userScopedClient(config: AppConfig, accessToken: string): SupabaseClient` (exists, `server/src/supabase.ts`)
- `supabaseOnboardingCompletionStore(db: SupabaseClient): CompletionStore` (exists, `server/src/context/onboarding.ts`)
- `supabaseOnboardingStore(db: SupabaseClient): OnboardingStore` (exists, `server/src/modules/onboarding/supabase-store.ts`)
- `createApp(config?: AppConfig): express.Express` (exists, `server/src/app.ts:33`)
- **Produces (new):** `OnboardingRouterDeps.makeOnboardingStore: (token: string) => OnboardingStore` (replaces the single `onboardingStore: OnboardingStore`)

- [ ] **Step 1: Write the failing HTTP-level regression test.**

Create `server/test/integration/onboarding-finish-wiring.test.ts`. It must drive the **real app wiring** (`createApp`) — NOT a hand-built service — so it catches the service-role mis-wiring. Model the auth/workspace setup on `server/test/integration/onboarding.test.ts` (createUser via `serviceClient(config).auth.admin.createUser`, sign in via `anonClient`, get `token`/`userId`). Then use supertest against `createApp(config)`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { loadConfig } from '../../src/config.js'
import { anonClient, serviceClient } from '../../src/supabase.js'
import { createApp } from '../../src/app.js'

const config = loadConfig()
const app = createApp(config)
const ts = Date.now()
const email = `onb-http-${ts}@test.dev`
const password = 'Test-pass-123456'
let token: string
let userId: string
let workspaceId: string

beforeAll(async () => {
  const admin = serviceClient(config)
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`createUser: ${error.message}`)
  const { data, error: sErr } = await anonClient(config).auth.signInWithPassword({ email, password })
  if (sErr || !data.session) throw new Error(`sign-in: ${sErr?.message}`)
  token = data.session.access_token
  userId = data.session.user.id
})

afterAll(async () => {
  const admin = serviceClient(config)
  if (workspaceId) await admin.from('workspaces').delete().eq('id', workspaceId)
  if (userId) await admin.auth.admin.deleteUser(userId)
})

describe('Onboarding finish — real app wiring (regression for C1)', () => {
  it('completes the full wizard through HTTP routes and finish returns 200', async () => {
    // 1. Create workspace (gate-exempt, auth only)
    const wsRes = await request(app)
      .post('/api/m/onboarding/workspace')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `HTTP Co ${ts}` })
    expect(wsRes.status).toBe(201)
    workspaceId = wsRes.body.workspaceId
    const h = { Authorization: `Bearer ${token}`, 'x-workspace-id': workspaceId }

    // 2. Steps (bodies mirror onboarding.test.ts payloads)
    expect((await request(app).put('/api/m/onboarding/profile').set(h)
      .send({ name: 'HTTP Corp', jurisdiction: 'AU', size: 'small', description: 'integration wiring test co' })).status).toBe(200)
    expect((await request(app).put('/api/m/onboarding/rules').set(h)
      .send([
        { ruleType: 'business_rule', area: 'Finance', statement: 'Invoices signed off by a manager', operator: null, value: null, consequence: 'rejected', appliesTo: ['manager'] },
        { ruleType: 'must_do', area: 'HR', statement: 'Staff complete onboarding training', operator: null, value: null, consequence: 'revoked', appliesTo: ['staff'] },
      ])).status).toBe(200)
    expect((await request(app).put('/api/m/onboarding/industry').set(h)
      .send({ anzsicCode: '7000', obligations: [{ name: 'Fair Work', description: 'comply' }] })).status).toBe(200)
    expect((await request(app).put('/api/m/onboarding/people').set(h)
      .send([{ personName: 'Bob', title: 'Ops Mgr', email: `bob-${ts}@http-corp.test`, responsibilities: ['ops'], role: 'manager', accessScope: { modules: ['operations'] }, invite: true }])).status).toBe(200)

    // 3. Finish — THIS is the regression. Pre-fix: 500 "must be authenticated". Post-fix: 200.
    const finishRes = await request(app).post('/api/m/onboarding/finish').set(h).send({})
    expect(finishRes.status).toBe(200)
    expect(finishRes.body.workspaceId).toBe(workspaceId)

    // 4. Confirm session completed (service client, bypasses RLS for assertion only)
    const admin = serviceClient(config)
    const { data: sessions } = await admin.from('onboarding_sessions').select('status').eq('workspace_id', workspaceId)
    expect(sessions?.[0]?.status).toBe('completed')
  })
})
```

- [ ] **Step 2: Run it — verify RED.**

Run: `npm run test:int --workspace server -- onboarding-finish-wiring`
Expected: FAIL — finish returns 500 (`"must be authenticated"`), so `expect(finishRes.status).toBe(200)` fails. (Confirms the bug is real through the app wiring.)

- [ ] **Step 3: Fix the wiring in `app.ts`.**

In the onboarding section: delete the module-global service-role stores and build them per-request from the token. Replace the `completionStore`/`onboardingStore` service-role construction and the `makeOnboardingService` factory with:

```ts
// ---- Onboarding: per-request user-scoped stores (RLS is the backstop) ----
// completionStore calls the SECURITY DEFINER complete_onboarding RPC, which requires
// auth.uid() — so it MUST run on the user's JWT, not service-role. onboarding_sessions /
// onboarding_invite_drafts are tenant rows with admin RLS (0011); user-scope them too.
const makeOnboardingStore = (token: string) => supabaseOnboardingStore(userScopedClient(config, token))

const makeOnboardingService = (token: string) =>
  createOnboardingService({
    hub: ContextHub,
    hubStore: supabaseHubStore(userScopedClient(config, token)),
    onboardingStore: makeOnboardingStore(token),
    completionStore: supabaseOnboardingCompletionStore(userScopedClient(config, token)),
    sendInvite: async (invite) => {
      await emailService.send(
        invite.email,
        'You have been invited to a workspace',
        'You have been invited to join workspace {{workspaceId}}. Your invite token is {{token}}.',
        { workspaceId: invite.workspaceId, token: invite.token }
      )
    },
  })
```

Delete the old `const completionStore = supabaseOnboardingCompletionStore(service)`, `setOnboardingStore(completionStore)`, and `const onboardingStore = supabaseOnboardingStore(service)` lines. Update the manifest call to pass the factory:

```ts
const manifest = createOnboardingManifest({
  makeService: makeOnboardingService,
  auth: authDeps,
  workspace: workspaceDeps,
  makeOnboardingStore,
  createWorkspace: createWorkspaceAction,
})
```

- [ ] **Step 4: Update the router to build the store per-request (`routes.ts`).**

Change `OnboardingRouterDeps`: replace `onboardingStore: OnboardingStore` with `makeOnboardingStore: (token: string) => OnboardingStore`. In `createOnboardingRouter`, destructure `makeOnboardingStore` and add a helper next to `resolveService`:

```ts
function resolveStore(req: import('express').Request): OnboardingStore {
  return makeOnboardingStore((req.headers.authorization ?? '').replace(/^Bearer /, ''))
}
```

Replace every direct `onboardingStore.X(...)` call in the handlers (the `POST /workspace` `createSession`, and the `getSession` calls in `/session`, `/profile`, `/rules`, `/industry`, `/people`, `/finish`, `/retry/:id`) with `resolveStore(req).X(...)`. For `POST /workspace` the caller is the authenticated workspace creator (owner ⇒ admin per RLS 0011), so the user-scoped `createSession` is allowed.

- [ ] **Step 5: Update `manifest.ts` if its types reference the old dep.**

`createOnboardingManifest(deps: OnboardingRouterDeps)` forwards `deps` unchanged — it compiles as-is once `OnboardingRouterDeps` is updated. No logic change; just confirm `npm run typecheck --workspace server` passes.

- [ ] **Step 6: Grep for the dead global; remove if unused.**

Run: `grep -rn "setOnboardingStore\|ContextHub.onboarding\|\.onboarding\.complete" server/src server/test`
If `ContextHub.onboarding.complete` / `setOnboardingStore` are not used by any request path or test, remove the `_completionStore` global + `setOnboardingStore` export + `onboarding` key from `context/index.ts` (and its import). If a test depends on it, leave it and note why.

- [ ] **Step 7: Run the regression test — verify GREEN.**

Run: `npm run test:int --workspace server -- onboarding-finish-wiring`
Expected: PASS (finish → 200, session completed).

- [ ] **Step 8: Run full suites — no regressions.**

Run: `npm test && npm run test:int --workspace server`
Expected: server unit 208+, web 78, integration 16 (15 + new), 0 failures. `npm run typecheck --workspace server` clean.

- [ ] **Step 9: Commit.**

```bash
git add -A && git commit -m "fix(onboarding): user-scope completionStore + onboardingStore so RLS is the backstop and finish works (C1, H2)"
```

---

### Task 2: Deny direct `workspaces` INSERT by `authenticated` (fixes H1)

**Why:** `0002_rls.sql:18` `create policy ws_insert on workspaces for insert with check (true)` + `0013` granting INSERT to `authenticated` lets any user `POST /rest/v1/workspaces` directly, bypassing `create_workspace` (orphan rows / slug-squatting). Force creation through the SECURITY DEFINER RPC.

**Files:**
- Create: `supabase/migrations/0017_workspaces_insert_lockdown.sql`
- Create: `supabase/tests/workspaces_insert_lockdown_test.sql`

**Interfaces:**
- `create_workspace(p_name text, p_slug text)` is SECURITY DEFINER (`0004`) — runs as owner, unaffected by revoking INSERT from `authenticated`.

- [ ] **Step 1: Write the failing pgTAP test.**

Create `supabase/tests/workspaces_insert_lockdown_test.sql`. It must prove (a) a plain authenticated user CANNOT directly INSERT a workspaces row, and (b) `create_workspace` STILL works for that user (positive control).

```sql
-- workspaces_insert_lockdown_test.sql
-- Direct INSERT into workspaces by `authenticated` must be denied (42501);
-- workspace creation must still work through the create_workspace RPC.
begin;
select plan(2);

insert into auth.users(id,email) values
  ('44444444-4444-4444-4444-444444444401','wslock@test.dev');

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"44444444-4444-4444-4444-444444444401","role":"authenticated"}';

-- (a) direct insert denied
select throws_ok(
  $$insert into workspaces(name,slug) values('rogue','rogue-slug')$$,
  '42501', null, 'authenticated cannot directly INSERT into workspaces');

-- (b) RPC still creates a workspace (returns a row with an id)
select isnt(
  (select (public.create_workspace('Legit Co','legit-co-wslock') ->> 'id')),
  null, 'create_workspace RPC still works for authenticated');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it — verify RED.**

Run: `psql postgresql://postgres:postgres@127.0.0.1:54332/postgres -f supabase/tests/workspaces_insert_lockdown_test.sql`
Expected: assertion (a) FAILS (`not ok` — the direct insert currently succeeds because of `with check (true)`).
(Note: the DB currently has migrations 0001-0016 applied; 0017 not yet.)

- [ ] **Step 3: Write the migration.**

Create `supabase/migrations/0017_workspaces_insert_lockdown.sql`:

```sql
-- 0017_workspaces_insert_lockdown.sql
-- SH-2.1 H1: close the workspaces direct-insert hole.
-- ws_insert (0002) used `with check (true)`, and 0013 grants INSERT to authenticated,
-- which together let any authenticated user POST /rest/v1/workspaces directly,
-- bypassing the create_workspace RPC (orphan rows / slug-squatting). Workspaces must
-- only be created via the SECURITY DEFINER create_workspace() function (runs as owner),
-- so revoke the direct table grant and drop the permissive insert policy.
drop policy if exists ws_insert on public.workspaces;
revoke insert on public.workspaces from authenticated;
```

- [ ] **Step 4: Apply the migration to the local DB.**

Run: `psql postgresql://postgres:postgres@127.0.0.1:54332/postgres -f supabase/migrations/0017_workspaces_insert_lockdown.sql`
Expected: `DROP POLICY` + `REVOKE`.

- [ ] **Step 5: Run the pgTAP test — verify GREEN.**

Run: `psql postgresql://postgres:postgres@127.0.0.1:54332/postgres -f supabase/tests/workspaces_insert_lockdown_test.sql`
Expected: `ok 1` (insert denied) and `ok 2` (RPC works); plan 2, 0 failures.

- [ ] **Step 6: Re-run the full pgTAP suite + integration tests — confirm nothing relied on direct workspace insert.**

Run each existing file in `supabase/tests/*.sql` via psql and confirm no `not ok`. Then `npm run test:int --workspace server` (the integration `beforeAll`s create workspaces via the RPC, so they must still pass).
Expected: all pgTAP green; integration 16 passing.

- [ ] **Step 7: Commit.**

```bash
git add -A && git commit -m "fix(db): deny direct workspaces INSERT by authenticated; force create_workspace RPC (H1) + pgTAP"
```

---

### Task 3: Fill pgTAP isolation gaps — write-denial for 7 tables + positive controls (fixes H3 + H4)

**Why:** `context_hub_write_isolation_test.sql` covers only 4 of 8 Hub entity tables; the other 4 (`internal_processes`, `decision_logic`, `risk_frameworks`, `governance`) and the 3 support/audit tables (`entity_versions`, `context_events`, `context_links`) have read-isolation only — a future `with check (true)` slip on any would pass CI. And two read-isolation suites assert only "sees 0 of foreign" with no positive control, so a `uid → NULL` regression (the same class as C1) would make every assertion trivially pass.

**Files:**
- Modify: `supabase/tests/context_hub_write_isolation_test.sql` (extend from 4 → 11 tables)
- Modify: `supabase/tests/context_hub_isolation_test.sql` (add positive control)
- Modify: `supabase/tests/tenant_isolation_test.sql` (add positive control)

**Interfaces (column shapes, confirmed from `context_hub_isolation_test.sql` seed rows):**
- `internal_processes(workspace_id, title)`, `decision_logic(workspace_id, name)`, `risk_frameworks(workspace_id, name)`, `governance(workspace_id, name, kind)`
- `entity_versions(workspace_id, entity_type, entity_id, version, snapshot, status)`, `context_events(workspace_id, type, entity_type, entity_id)`, `context_links(workspace_id, from_type, from_id, to_type, to_id)`

- [ ] **Step 1: Extend the write-isolation test (RED first).**

First confirm each of the 7 tables has an INSERT policy that yields `42501` for a foreign member (read `supabase/migrations/0007*`/`0008*` for the policies). For tables written only by SECURITY DEFINER triggers (`entity_versions`, `context_events`), a direct authenticated INSERT is denied either by an explicit `with check` or by RLS default-deny (no permissive insert policy) — both raise `42501`, which is the correct assertion.

Bump `select plan(8)` to `select plan(22)` (4 existing inserts + 4 existing updates + 7 new inserts + 7 new updates). Add seed rows for the 7 tables in the G workspace (superuser, before the role switch), mirroring the existing pattern at lines 20-27 using the column shapes above. Then add `throws_ok(... '42501' ...)` insert-denial assertions and `do $$ ... update ... $$` + read-back `is(...)` assertions for each of the 7 tables, following the exact structure already in the file (lines 35-102).

Example additions (insert-denial for one table; replicate for all 7):

```sql
select throws_ok(
  $$insert into internal_processes(workspace_id,title)
    values('22222222-2222-2222-2222-222222222201','injected')$$,
  '42501', null, 'internal_processes: foreign member cannot insert into another workspace');
```

And the matching read-back (seed `internal_processes` id `...05` with title `G process` up top):

```sql
do $$ begin update internal_processes set title='pwned'
  where workspace_id='22222222-2222-2222-2222-222222222201'; end $$;
-- ...after switching back to G owner:
select is(
  (select title from internal_processes where id='33333333-3333-3333-3333-333333333305'),
  'G process', 'internal_processes: foreign member cannot update another workspace row');
```

- [ ] **Step 2: Run write-isolation test — verify it passes for real (and the count is right).**

Run: `psql postgresql://postgres:postgres@127.0.0.1:54332/postgres -f supabase/tests/context_hub_write_isolation_test.sql`
Expected: `1..22`, all `ok`, 0 `not ok`. (If any table's policy is actually permissive, that assertion will `not ok` — a real finding to escalate, not to paper over.)

- [ ] **Step 3: Add positive controls to the two read-isolation suites.**

In `context_hub_isolation_test.sql`: bump `plan(11)` → `plan(12)`; before the cross-tenant zeros, add a row visible to F1 and assert F1 sees it. The simplest: while still superuser, also seed one `business_profile` in F1's workspace (`ffffffff-...0001`), then after the role/claims switch to F1 add:

```sql
select is((select count(*)::int from business_profile where workspace_id='ffffffff-0000-0000-0000-000000000001'),1,'positive control: F1 sees its own business_profile');
```

In `tenant_isolation_test.sql`: bump its plan by 1 and add an analogous "tenant E1 sees its own membership/feature row (count ≥ 1)" assertion before the cross-tenant zeros (read the file first to match its fixtures/ids).

- [ ] **Step 4: Run both read-isolation suites — verify GREEN with the new controls.**

Run each via psql. Expected: new plan counts, all `ok`. The positive control must PASS (proving the suite would catch a `uid → NULL` regression rather than silently passing).

- [ ] **Step 5: Run the full pgTAP suite — all green.**

Run every `supabase/tests/*.sql` via psql; confirm no `not ok` anywhere.

- [ ] **Step 6: Commit.**

```bash
git add -A && git commit -m "test(rls): write-denial for 7 tenant tables incl audit trail + positive controls (H3, H4)"
```

---

### Task 4: Fix dead live assertions + reject blank token (fixes M1 + M3)

**Why:** In `sp3-modules.test.ts` the write-denial assertions are dead — `.insert()` without `.select()` returns `data: null` so `rowsInserted` is always 0, and `.update()` without `{count}` leaves `count` null — so those `expect`s pass even if the write succeeded (only the read-back guards provide real proof). And `userScopedClient` sets `Authorization: Bearer ${accessToken}` even for a blank token — a latent fail-open if a future route forgets `requireAuth`.

**Files:**
- Modify: `server/src/supabase.ts` (`userScopedClient`)
- Modify: `server/test/integration/sp3-modules.test.ts` (assertions near lines 295-299, 328-331, 349-353, 380-383)
- Test (new): `server/test/supabase.test.ts` (unit test for the blank-token guard)

**Interfaces:**
- `userScopedClient(config, accessToken)` — add: throw on falsy/blank token.

- [ ] **Step 1: Write the failing unit test for the token guard.**

Create `server/test/supabase.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { userScopedClient } from '../src/supabase.js'

const config = { supabaseUrl: 'http://127.0.0.1:54331', supabaseAnonKey: 'anon', supabaseServiceRoleKey: 'svc', port: 3001 }

describe('userScopedClient', () => {
  it('throws on a blank access token (fail-closed, not anon fallback)', () => {
    expect(() => userScopedClient(config, '')).toThrow(/access token/i)
  })
  it('builds a client when given a token', () => {
    expect(userScopedClient(config, 'jwt-xyz')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it — verify RED.**

Run: `npm run test --workspace server -- supabase`
Expected: FAIL — the blank-token case currently returns a client instead of throwing.

- [ ] **Step 3: Add the guard in `supabase.ts`.**

```ts
export function userScopedClient(config: AppConfig, accessToken: string): SupabaseClient {
  if (!accessToken || !accessToken.trim()) {
    throw new Error('userScopedClient requires a non-empty access token')
  }
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}
```

- [ ] **Step 4: Confirm no caller passes a blank token.**

Run: `grep -rn "userScopedClient(" server/src`
For each caller, confirm the token comes from a `requireAuth`-guarded path (`req.accessToken` or a header after `requireAuth`). The known callers (`resolveService`/`resolveStore`, the risk/complaints/improvements factories, `createWorkspaceAction`, bootstrap `getUserWorkspaces`) all run after `requireAuth`. If any path could pass `''`, it indicates a missing `requireAuth` — fix that path (do not weaken the guard).

- [ ] **Step 5: Fix the dead assertions in `sp3-modules.test.ts`.**

For the two insert-denial blocks (~295-299, ~349-353): make the primary assertion meaningful by asserting an RLS error on a foreign-tenant insert. Replace the `rowsInserted`-based check with an explicit error assertion, e.g.:

```ts
const { error: insErr } = await tenant2Db.from('risk_entries').insert({ /* foreign workspace_id */ ... })
expect(insErr).not.toBeNull() // RLS with-check denies → error (42501)
```

For the two update-denial blocks (~328-331, ~380-383): use a counted update and assert 0 rows changed:

```ts
const { count, error: updErr } = await tenant2Db
  .from('risk_entries').update({ /* mutation */ }, { count: 'exact' })
  .eq('id', tenant1RowId)
expect(updErr ?? null).toBeNull()
expect(count ?? 0).toBe(0)
```

Keep the existing read-back guards (they are correct defense-in-depth). Read the surrounding test to match variable names (`tenant2Db`, the tenant-1 row ids, the exact column being mutated).

- [ ] **Step 6: Run the affected suites — verify GREEN.**

Run: `npm run test --workspace server -- supabase` then `npm run test:int --workspace server`
Expected: new unit test passes; sp3-modules integration still passes (now with meaningful assertions).

- [ ] **Step 7: Run full suites — no regressions.**

Run: `npm test && npm run test:int --workspace server`
Expected: server unit 210+ (208 + 2 new), web 78, integration 16, 0 failures.

- [ ] **Step 8: Commit.**

```bash
git add -A && git commit -m "harden: userScopedClient rejects blank token (M3); fix dead write-denial assertions (M1)"
```

---

## Self-Review notes

- **Spec coverage:** C1+H2 → Task 1; H1 → Task 2; H3+H4 → Task 3; M1+M3 → Task 4. (M2, L1, L2, L3 are explicitly out of scope per the approved remediation set — they remain in the review doc as follow-ups.)
- **Type consistency:** `makeOnboardingStore: (token: string) => OnboardingStore` is defined in Task 1 (app.ts) and consumed in Task 1 (routes.ts deps). `userScopedClient` signature unchanged (Task 4 only adds an internal guard).
- **Ordering:** Tasks are independent enough to do in order 1→2→3→4. Task 1 (TS) and Tasks 2/3 (SQL) don't overlap files; Task 4 touches `supabase.ts` + one integration test, also non-overlapping with 1. Run sequentially with a review gate per task.
