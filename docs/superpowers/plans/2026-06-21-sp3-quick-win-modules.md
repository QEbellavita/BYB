# SP-3 Quick-Win Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build three Feature-Registry-gated modules on the Context Hub — Risk Register, Complaints Register, and an event-driven Improvements register — proving the module pattern and the SP-1 event bus.

**Architecture:** Each module owns its tables (operational data) and references Hub entities via `context_links`; modules never write Hub business context nor read each other's tables. Risk/complaint writes `publish` an event into the `context_events` outbox and trigger SP-1's `dispatchPendingEvents`; a registered improvement subscriber evaluates deterministic rules and upserts deduped suggestions. No LLM, no scheduler.

**Tech Stack:** Node 20+, Express 4, TypeScript strict/ESM, Supabase Postgres/RLS, Vitest + Supertest, pgTAP; React 18 + Vite.

## Global Constraints

- BYB is standalone. No Quantara/Neural Workflow/biometric/ML/multifractal/LLM dependencies. All SP-3 "intelligence" is deterministic.
- A module owns ONLY its own tables; never writes Hub business context; never reads another module's tables. Hub references go through `context_links` (`links.connect`/`links.list`); the only direct FK to a Hub table is `risk_entries.framework_id → risk_frameworks`.
- RLS on every new table keyed on `public.is_workspace_member(workspace_id)`, with a passing pgTAP cross-tenant isolation test before merge. Never relaxed.
- New tables inherit grants from migration 0013's `ALTER DEFAULT PRIVILEGES` (authenticated, service_role); the pgTAP test (run as `authenticated`) verifies this — if a table is denied, add explicit `grant` to that migration.
- RLS-sensitive server queries use `userScopedClient` (user JWT). The event `publish`/dispatch + improvement subscriber run server-side with the service-role client (they react to already-authorized writes).
- Each module gated by the Feature Registry (`defaultEnabled: true`), mounted at `/api/m/<id>`; routes use `requireAuth` / `authedWorkspaceRoute` / `requirePermission`.
- TypeScript strict + ESM; server local imports use `.js` extensions. Web follows the existing design-system; `web/tsconfig.json` has `noEmit` — no stray `.js`.
- pgTAP locally is run via psql (`postgresql://postgres:postgres@127.0.0.1:54332/postgres`) because the local `supabase test db` CLI is broken (discovers 0 files); CI runs the real gate.
- Test-first red/green for every behavior. Conventional commits on `sp-3-modules`.

## Pattern reference

The existing `server/src/modules/onboarding/` module is the canonical pattern to mirror for file layout, the `supabase-store` row-mapping style, route error-mapping (validation→400, conflict/stale→409, else→500), `ModuleManifest`, and wiring in `server/src/app.ts`. Read it before each server task. Reuse, don't reinvent: `is_workspace_member`, `authedWorkspaceRoute`, `requirePermission`, `links` (`server/src/context/links.ts`), `createRegistry`/`dispatchPendingEvents` (`server/src/context/events.ts`), `supabaseEventStore` (`server/src/context/supabase-store.ts`).

## File Structure

```
supabase/migrations/0014_risk_entries.sql           (Task 1)
supabase/migrations/0015_complaints.sql             (Task 2)
supabase/migrations/0016_improvements.sql           (Task 3)
supabase/tests/risk_entries_isolation_test.sql      (Task 1)
supabase/tests/complaints_isolation_test.sql        (Task 2)
supabase/tests/improvements_isolation_test.sql      (Task 3)
server/src/modules/risk/{types,validation,supabase-store,service,routes,manifest}.ts   (Task 4)
server/src/modules/complaints/{...same six...}.ts    (Task 5)
server/src/modules/improvements/{types,validation,supabase-store,service,routes,manifest}.ts  (Task 6)
server/src/modules/improvements/subscriber.ts        (Task 6 — the agent rules)
server/src/events/publish.ts                         (Task 4 — shared publish seam)
server/src/app.ts                                    (modified Tasks 4,5,6)
server/test/{risk,complaints,improvements}/*.test.ts (Tasks 4,5,6)
web/src/app/RiskPage.tsx                             (modified Task 7)
web/src/app/risk-api.ts, ComplaintsPage.tsx, ImprovementsPage.tsx (Tasks 7–9)
web/src/Shell.tsx                                    (modified Task 9 — nav item)
server/test/integration/sp3-modules.test.ts          (Task 10)
```

Severity helper (shared, server): create `server/src/modules/risk/severity.ts` in Task 4.

---

### Task 1: risk_entries table + RLS + pgTAP gate

**Files:**
- Create: `supabase/migrations/0014_risk_entries.sql`
- Create: `supabase/tests/risk_entries_isolation_test.sql`

**Interfaces:**
- Produces table `risk_entries` (columns below) with membership RLS.
- Consumed by: Tasks 4, 6, 10.

- [ ] **Step 1: Write the failing pgTAP isolation test**

Create `supabase/tests/risk_entries_isolation_test.sql`:

```sql
begin;
select plan(3);

insert into auth.users(id,email) values
  ('00000000-0000-0000-0000-0000000000c1','owner-c@test.dev'),
  ('00000000-0000-0000-0000-0000000000d1','owner-d@test.dev');
insert into workspaces(id,name,slug) values
  ('cccccccc-0000-0000-0000-000000000001','C Co','c-co'),
  ('dddddddd-0000-0000-0000-000000000001','D Co','d-co');
insert into workspace_members(workspace_id,user_id,role) values
  ('cccccccc-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1','owner'),
  ('dddddddd-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1','owner');
insert into risk_entries(id,workspace_id,title,likelihood,impact,created_by) values
  ('eeeeeeee-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','C risk',4,4,
   '00000000-0000-0000-0000-0000000000c1');

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is((select count(*)::int from risk_entries), 1, 'owner C sees own risk');
select lives_ok(
  $$insert into risk_entries(workspace_id,title,likelihood,impact)
    values('cccccccc-0000-0000-0000-000000000001','C risk 2',2,3)$$,
  'member can insert a risk in own workspace');

set local "request.jwt.claims" =
  '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select is((select count(*)::int from risk_entries
  where workspace_id='cccccccc-0000-0000-0000-000000000001'),
  0, 'other tenant cannot see C risks');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it and verify RED**

Run: `npm run db:reset && psql postgresql://postgres:postgres@127.0.0.1:54332/postgres -Xq -f supabase/tests/risk_entries_isolation_test.sql`
Expected: error / `not ok` — `risk_entries` does not exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0014_risk_entries.sql`:

```sql
-- 0014_risk_entries.sql — Risk Register module (operational risk entries).
create table risk_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title text not null,
  description text,
  category text,
  likelihood int not null check (likelihood between 1 and 5),
  impact int not null check (impact between 1 and 5),
  owner_person_id uuid references org_people(id) on delete set null,
  treatment text,
  status text not null default 'open'
    check (status in ('open','mitigating','accepted','closed')),
  review_date date,
  framework_id uuid references risk_frameworks(id) on delete set null,
  version int not null default 1,
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now()
);
create index risk_entries_ws_idx on risk_entries(workspace_id);

alter table risk_entries enable row level security;
create policy risk_entries_member on risk_entries for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
```

- [ ] **Step 4: Run the test + full pgTAP gate, verify GREEN**

Run: `npm run db:reset && for f in supabase/tests/*.sql; do echo "== $f =="; psql postgresql://postgres:postgres@127.0.0.1:54332/postgres -Xq -f "$f" 2>&1 | grep -E "not ok|ERROR"; done`
Expected: no `not ok`/`ERROR` lines (risk_entries 3/3; SP-0/1/2 tests still pass). If `risk_entries` denies the `authenticated` insert/select, add `grant select, insert, update, delete on risk_entries to authenticated, service_role;` to the migration and re-run.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0014_risk_entries.sql supabase/tests/risk_entries_isolation_test.sql
git commit -m "feat: risk_entries table with membership RLS"
```

---

### Task 2: complaints table + RLS + pgTAP gate

**Files:**
- Create: `supabase/migrations/0015_complaints.sql`
- Create: `supabase/tests/complaints_isolation_test.sql`

**Interfaces:**
- Produces table `complaints`; consumed by Tasks 5, 6, 10.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/complaints_isolation_test.sql` mirroring Task 1's structure (two workspaces C/D, owners) but for `complaints`:

```sql
begin;
select plan(3);
insert into auth.users(id,email) values
  ('00000000-0000-0000-0000-0000000000c1','owner-c@test.dev'),
  ('00000000-0000-0000-0000-0000000000d1','owner-d@test.dev');
insert into workspaces(id,name,slug) values
  ('cccccccc-0000-0000-0000-000000000001','C Co','c-co'),
  ('dddddddd-0000-0000-0000-000000000001','D Co','d-co');
insert into workspace_members(workspace_id,user_id,role) values
  ('cccccccc-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1','owner'),
  ('dddddddd-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1','owner');
insert into complaints(id,workspace_id,reference,description,created_by) values
  ('ffffffff-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','C-001','late delivery',
   '00000000-0000-0000-0000-0000000000c1');

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is((select count(*)::int from complaints), 1, 'owner C sees own complaint');
select lives_ok(
  $$insert into complaints(workspace_id,reference,description)
    values('cccccccc-0000-0000-0000-000000000001','C-002','billing error')$$,
  'member can insert a complaint in own workspace');

set local "request.jwt.claims" =
  '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select is((select count(*)::int from complaints
  where workspace_id='cccccccc-0000-0000-0000-000000000001'),
  0, 'other tenant cannot see C complaints');
select * from finish();
rollback;
```

- [ ] **Step 2: Run + verify RED**

Run: `npm run db:reset && psql postgresql://postgres:postgres@127.0.0.1:54332/postgres -Xq -f supabase/tests/complaints_isolation_test.sql`
Expected: fails — `complaints` does not exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0015_complaints.sql`:

```sql
-- 0015_complaints.sql — Complaints Register module.
create table complaints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  reference text not null,
  complainant_name text,
  complainant_contact text,
  channel text check (channel in ('phone','email','in_person','web','other')),
  received_at timestamptz not null default now(),
  description text not null,
  category text,
  severity text not null default 'low' check (severity in ('low','medium','high')),
  assignee_person_id uuid references org_people(id) on delete set null,
  status text not null default 'new' check (status in ('new','in_progress','resolved','closed')),
  resolution_notes text,
  resolved_at timestamptz,
  version int not null default 1,
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  unique (workspace_id, reference)
);
create index complaints_ws_idx on complaints(workspace_id);
create index complaints_ws_cat_idx on complaints(workspace_id, category);

alter table complaints enable row level security;
create policy complaints_member on complaints for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
```

- [ ] **Step 4: Run the test + full gate, verify GREEN**

Run the same full-gate loop as Task 1 Step 4. Expected: no `not ok`/`ERROR`. Add explicit grants if denied.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0015_complaints.sql supabase/tests/complaints_isolation_test.sql
git commit -m "feat: complaints table with membership RLS"
```

---

### Task 3: improvements table (+ dedup) + RLS + pgTAP gate

**Files:**
- Create: `supabase/migrations/0016_improvements.sql`
- Create: `supabase/tests/improvements_isolation_test.sql`

**Interfaces:**
- Produces table `improvements` with partial-unique dedup; consumed by Tasks 6, 10.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/improvements_isolation_test.sql`: plan(4); same C/D fixtures; insert an `improvements` row (`source='manual'`); assert owner C sees 1, owner D sees 0; AND assert the dedup index blocks a second open auto-suggestion with the same `dedup_key`:

```sql
-- after the C/D + members fixtures (as Task 1), before role switch:
insert into improvements(id,workspace_id,source,title,status,created_by) values
  ('aaaaaaaa-0000-0000-0000-000000000009','cccccccc-0000-0000-0000-000000000001','manual','idea','open',
   '00000000-0000-0000-0000-0000000000c1');
insert into improvements(workspace_id,source,title,status,trigger_kind,dedup_key) values
  ('cccccccc-0000-0000-0000-000000000001','auto','auto1','open','untreated_high_risk','untreated_high_risk:x');
select throws_ok(
  $$insert into improvements(workspace_id,source,title,status,trigger_kind,dedup_key)
    values('cccccccc-0000-0000-0000-000000000001','auto','dup','open','untreated_high_risk','untreated_high_risk:x')$$,
  '23505', null, 'dedup blocks a second open auto-suggestion with same key');
-- then role-switch C: sees 2 (manual + auto); role-switch D: sees 0
```

(Use `plan(4)`: C-sees-2, D-sees-0, member-insert lives_ok, dedup throws_ok.)

- [ ] **Step 2: Run + verify RED** (`improvements` does not exist).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0016_improvements.sql`:

```sql
-- 0016_improvements.sql — Improvements register (auto-suggested + manual).
create table improvements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source text not null check (source in ('auto','manual')),
  title text not null,
  detail text,
  trigger_kind text check (trigger_kind in
    ('recurring_complaints','untreated_high_risk','overdue_risk_review')),
  source_ref jsonb not null default '{}'::jsonb,
  dedup_key text,
  suggested_change text,
  status text not null default 'open' check (status in ('open','actioned','dismissed','done')),
  assignee_person_id uuid references org_people(id) on delete set null,
  version int not null default 1,
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now()
);
create index improvements_ws_idx on improvements(workspace_id);
-- one OPEN auto suggestion per (workspace, dedup_key)
create unique index improvements_auto_open_uniq
  on improvements(workspace_id, dedup_key)
  where source = 'auto' and status = 'open';

alter table improvements enable row level security;
create policy improvements_member on improvements for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
```

- [ ] **Step 4: Run the test + full gate, verify GREEN** (as Task 1 Step 4; add grants if denied).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0016_improvements.sql supabase/tests/improvements_isolation_test.sql
git commit -m "feat: improvements table with dedup index and RLS"
```

---

### Task 4: Risk module (server) + event publish seam

**Files:**
- Create: `server/src/errors.ts` (shared `StaleDraftError`)
- Create: `server/src/events/publish.ts`
- Create: `server/src/modules/risk/{severity,types,validation,supabase-store,service,routes,manifest}.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/risk/{severity,validation,service,routes}.test.ts`

**Interfaces:**
- Consumes: `HubStore`-style patterns, `authedWorkspaceRoute`, `requirePermission`, `links`.
- Produces: `severityBucket(likelihood,impact)`, `StaleDraftError` (shared, in `server/src/errors.ts`), `createRiskService(deps)` with `list/create/update/close`, a `Publish` type `(e: PublishEvent) => Promise<void>`, and `createRiskManifest(deps)`.

**Shared error:** create `server/src/errors.ts`:
```ts
export class StaleDraftError extends Error {
  constructor(public readonly entity: string, public readonly id: string) {
    super(`stale ${entity} ${id}`)
    this.name = 'StaleDraftError'
  }
}
```
All three SP-3 modules and their routes import `StaleDraftError` from `../../errors.js` (do NOT import onboarding's copy — that would couple modules). Routes map `instanceof StaleDraftError` → 409 `{error:'draft changed; reload and retry'}`.

- [ ] **Step 1: Write the failing severity + validation tests**

`server/test/risk/severity.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { severityBucket } from '../../src/modules/risk/severity.js'
describe('severityBucket', () => {
  it('buckets l*i', () => {
    expect(severityBucket(1,1)).toBe('low')      // 1
    expect(severityBucket(2,3)).toBe('med')      // 6
    expect(severityBucket(3,4)).toBe('high')     // 12
    expect(severityBucket(5,5)).toBe('ext')      // 25
  })
})
```
`server/test/risk/validation.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { validateRisk } from '../../src/modules/risk/validation.js'
describe('validateRisk', () => {
  it('accepts a valid risk and trims title', () => {
    expect(validateRisk({ title: '  Fire  ', likelihood: 3, impact: 4 }))
      .toEqual({ ok: true, value: expect.objectContaining({ title: 'Fire', likelihood: 3, impact: 4, status: 'open' }) })
  })
  it('rejects out-of-range likelihood', () => {
    expect(validateRisk({ title: 'X', likelihood: 9, impact: 2 }))
      .toEqual({ ok: false, errors: { likelihood: 'Must be 1–5' } })
  })
  it('rejects empty title', () => {
    expect(validateRisk({ title: '  ', likelihood: 1, impact: 1 }).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run + verify RED**

Run: `npm run test:server -- --run test/risk/severity.test.ts test/risk/validation.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement severity, types, validation**

`severity.ts`:
```ts
export type Severity = 'low' | 'med' | 'high' | 'ext'
export function severityBucket(likelihood: number, impact: number): Severity {
  const s = likelihood * impact
  if (s >= 15) return 'ext'
  if (s >= 12) return 'high'
  if (s >= 6) return 'med'
  return 'low'
}
```
`types.ts` — `RiskStatus = 'open'|'mitigating'|'accepted'|'closed'`; `RiskInput { id?; version?; title; description?; category?; likelihood; impact; ownerPersonId?; treatment?; status?; reviewDate?; frameworkId? }`; `RiskRow` (db shape with snake_case + id/version/timestamps); `RiskStore { list(workspaceId), create(row), update(id, patch), getById(id) }`; `ValidationResult<T>` (same shape as onboarding). Validation: trim title (required), likelihood/impact integers 1–5 (`'Must be 1–5'`), default status 'open', pass through optional fields.

- [ ] **Step 4: Write the failing service test (Hub-only, publishes events, optimistic concurrency)**

`server/test/risk/service.test.ts`: with in-memory fake store + fake `publish` (records events) + fake `links`:
```ts
// create → store.create called with workspace_id + status:'open'; publish called with type 'risk.created'
// update with {id, version} where store version differs → throws StaleDraftError, no write
// close → status 'closed', publish 'risk.updated' (or 'risk.closed')
// link to a rule → links.connect called from {type:'risk_entry',id} to {type:'business_rule',id}, relation 'addresses'
```
Assert the published event shape `{ type:'risk.created', entity_type:'risk_entry', entity_id, workspace_id, after }`.

- [ ] **Step 5: Run + verify RED** (`createRiskService` missing).

- [ ] **Step 6: Implement publish seam + store + service**

`server/src/events/publish.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseEventStore, type EventStore } from '../context/supabase-store.js' // re-export if needed
import { dispatchPendingEvents, type Registry } from '../context/events.js'

export interface PublishEvent {
  workspace_id: string; type: string; entity_type: string; entity_id: string
  after?: unknown; actor?: string | null
}
export type Publish = (e: PublishEvent) => Promise<void>

// Production publisher: insert into context_events outbox, then dispatch subscribers.
export function makePublish(db: SupabaseClient, store: EventStore, registry: Registry): Publish {
  return async (e) => {
    const { error } = await db.from('context_events').insert({
      workspace_id: e.workspace_id, type: e.type,
      entity_type: e.entity_type, entity_id: e.entity_id,
      after: e.after ?? null, actor: e.actor ?? null,
    })
    if (error) throw new Error(`publish ${e.type}: ${error.message}`)
    await dispatchPendingEvents(store, registry)
  }
}
```
(If `EventStore` isn't exported from supabase-store, import the type from `../context/events.js`.)

`risk/supabase-store.ts` — Supabase `RiskStore` (mirror onboarding's store mapping; table `risk_entries`). `risk/service.ts` — `createRiskService({ store, publish, links, linkStore })` returning named async fns `list/create/update/close`; `create` inserts `status:'open'` then `publish({type:'risk.created', entity_type:'risk_entry', entity_id:row.id, workspace_id, after:row})`; `update` does `getById` + version check → throw `StaleDraftError` (export a class) on mismatch, else update + `publish('risk.updated')`; `close` sets status 'closed' + publish; optional `linkRule(ctx, riskId, ruleId)` via `links.connect`.

- [ ] **Step 7: Write failing route test, then implement routes + manifest + wire createApp**

`server/test/risk/routes.test.ts` (Supertest, injected fake service): GET `/api/m/risk/risks` → 200 list; POST `/risks` valid → 201; POST invalid → 400; PUT `/risks/:id` stale → 409 `{error:'draft changed; reload and retry'}`. `routes.ts` mirrors onboarding error-mapping; mount under the module (loader prefixes `/api/m/risk`). `manifest.ts` → `createRiskManifest(deps)` `{ id:'risk', name:'Risk Register', dependsOn:[], defaultEnabled:true, register(router){ router.use(createRiskRouter(deps)) } }`. In `app.ts`: build the shared `registry = createRegistry()` and `eventStore = supabaseEventStore(service)`, `publish = makePublish(service, eventStore, registry)`, construct the risk service with `publish` + a Supabase `linkStore`, and add the risk manifest to the `registerModules([...])` array.

- [ ] **Step 8: Run focused + full suite + build, verify GREEN**

Run: `npm run test:server -- --run test/risk/ ` then `npm run test:server` then `npm run build --workspace server`. Expected: all pass, zero TS errors.

- [ ] **Step 9: Commit**

```bash
git add server/src/events server/src/modules/risk server/src/app.ts server/test/risk
git commit -m "feat: risk register module with event publish seam"
```

---

### Task 5: Complaints module (server)

**Files:**
- Create: `server/src/modules/complaints/{types,validation,supabase-store,service,routes,manifest}.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/complaints/{validation,service,routes}.test.ts`

**Interfaces:**
- Consumes: `Publish` (Task 4), `links`, route middleware.
- Produces: `createComplaintsService(deps)` with `list/create/update/resolve`, `createComplaintsManifest(deps)`.

- [ ] **Step 1: Write failing validation test**

`validateComplaint`: requires non-empty `description`; `channel` (if present) in the enum; `severity` defaults 'low'; status defaults 'new'; generates nothing (reference is assigned in the service). Test valid + missing-description (`{description:'Required'}`) + bad channel.

- [ ] **Step 2: Run + verify RED.**

- [ ] **Step 3: Implement types + validation** (mirror Task 4; `ComplaintStatus='new'|'in_progress'|'resolved'|'closed'`, `ComplaintInput`, `ComplaintRow`, `ComplaintStore`).

- [ ] **Step 4: Write failing service test**

Assert: `create` assigns a `reference` `C-<n>` (e.g. zero-padded count+1 per workspace, or `C-`+short id — test that it starts with `C-`), inserts status 'new', publishes `complaint.created`; `update` version-checked (StaleDraftError on mismatch); `resolve(ctx,id)` sets status 'resolved' + `resolved_at` + publishes `complaint.resolved`; `linkRule`/`linkProcess` via `links.connect` relation `'concerns'`; status transitions validated (cannot resolve a 'closed' complaint → throws).

- [ ] **Step 5: Run + verify RED.**

- [ ] **Step 6: Implement store + service** (mirror Task 4; reference generation: `const n = (await store.countForWorkspace(workspaceId)) + 1; reference = 'C-' + String(n).padStart(3,'0')` — add `countForWorkspace` to the store).

- [ ] **Step 7: Write failing route test + implement routes + manifest + wire app**

Routes: GET `/api/m/complaints/complaints`, POST (201/400), PUT `/:id` (409 on stale), POST `/:id/resolve`. `createComplaintsManifest` `{ id:'complaints', name:'Complaints', ... }`. Add to `registerModules` array in `app.ts` with `publish` injected.

- [ ] **Step 8: Run focused + full suite + build, verify GREEN.**

- [ ] **Step 9: Commit**

```bash
git add server/src/modules/complaints server/src/app.ts server/test/complaints
git commit -m "feat: complaints register module"
```

---

### Task 6: Improvements module + the event-driven agent

**Files:**
- Create: `server/src/modules/improvements/{types,validation,supabase-store,service,routes,manifest,subscriber}.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/improvements/{validation,service,subscriber,routes}.test.ts`

**Interfaces:**
- Consumes: `RiskStore`, `ComplaintStore`, `ImprovementStore`, `ContextEvent`, the event `registry`.
- Produces: `createImprovementService(deps)` (`list/create/update`), `registerImprovementSubscriber(registry, deps)`, `createImprovementsManifest(deps)`. Named rule constants `RECURRING_COMPLAINTS_THRESHOLD=3`, `RECURRING_WINDOW_DAYS=90`, `HIGH_SEVERITY_MIN=12`.

- [ ] **Step 1: Write failing validation + service tests**

`validateImprovement` (manual): requires `title`; `source` forced to 'manual' for the manual create path; status defaults 'open'. Service `create` (manual) inserts source 'manual'; `update` version-checked; `setStatus(id, status)` to actioned/dismissed/done.

- [ ] **Step 2: Run + verify RED.**

- [ ] **Step 3: Implement types/validation/store/service** (mirror Tasks 4/5; table `improvements`; store adds `upsertAuto(row)` that does `insert ... on conflict (workspace_id,dedup_key) where source='auto' and status='open' do nothing` semantics — implement as: try select open auto by dedup_key; if none, insert; return).

- [ ] **Step 4: Write the failing subscriber tests (the agent rules)**

`server/test/improvements/subscriber.test.ts` — with fake `riskStore`, `complaintStore`, `improvementStore` (records `upsertAuto`/`setStatus` calls):
```ts
// untreated_high_risk: event 'risk.updated' for a risk l*i>=12, status 'open', empty treatment
//   → upsertAuto with trigger_kind 'untreated_high_risk', dedup_key 'untreated_high_risk:'+riskId
// treatment added (treatment non-empty) OR status 'closed'
//   → existing open auto suggestion for that risk is set 'done' (cleared)
// overdue_risk_review: risk.review_date < today, status not closed → upsertAuto 'overdue_risk_review:'+riskId
// recurring_complaints: event 'complaint.created'; complaintStore reports >=3 non-closed in same category within 90d
//   → upsertAuto 'recurring_complaints:'+category ; <3 → no suggestion
// dedup: second identical event does not create a second suggestion (upsertAuto idempotent on open)
```
Pass a fixed `now` into the handler factory (`registerImprovementSubscriber(registry, deps, now)`) so "today"/90-day windows are deterministic (do NOT call Date.now() inside — inject it).

- [ ] **Step 5: Run + verify RED.**

- [ ] **Step 6: Implement the subscriber**

`subscriber.ts`:
```ts
import type { Registry, ContextEvent } from '../../context/events.js'
export const RECURRING_COMPLAINTS_THRESHOLD = 3
export const RECURRING_WINDOW_DAYS = 90
export const HIGH_SEVERITY_MIN = 12

export interface SubscriberDeps {
  riskStore: { getById(id: string): Promise<RiskRow | null> }
  complaintStore: { getById(id: string): Promise<ComplaintRow | null>;
    countByCategorySince(workspaceId: string, category: string, sinceIso: string): Promise<number> }
  improvementStore: {
    upsertAuto(row: AutoSuggestion): Promise<void>
    clearAuto(workspaceId: string, dedupKey: string): Promise<void> // set matching open auto → 'done'
  }
}
export function registerImprovementSubscriber(registry: Registry, deps: SubscriberDeps, now: () => Date) {
  registry.on('risk.', async (e) => { /* untreated_high_risk + overdue_risk_review rules */ })
  registry.on('complaint.', async (e) => { /* recurring_complaints rule */ })
}
```
Implement each rule per the spec; build `dedup_key` exactly as the tests assert; on the high-risk "cleared" condition call `clearAuto`. Use `e.after` (the row snapshot) plus a store re-read where needed. Window: `sinceIso = new Date(now().getTime() - RECURRING_WINDOW_DAYS*864e5).toISOString()`.

- [ ] **Step 7: Run subscriber tests + verify GREEN.**

- [ ] **Step 8: Write failing routes test + implement routes/manifest + wire app (register subscriber)**

Routes: GET `/api/m/improvements/improvements` (list, filter by status), POST `/improvements` (manual create, 201/400), PUT `/:id` (409 stale), POST `/:id/status` (`{status}`). `createImprovementsManifest` `{ id:'improvements', name:'Improvements', ... }`. In `app.ts`: after building the registry, call `registerImprovementSubscriber(registry, { riskStore, complaintStore: <+countByCategorySince>, improvementStore }, () => new Date())`, and add the manifest to `registerModules`. Add `countByCategorySince` + `upsertAuto` + `clearAuto` to the respective Supabase stores.

- [ ] **Step 9: Run focused + full suite + build, verify GREEN.**

- [ ] **Step 10: Commit**

```bash
git add server/src/modules/improvements server/src/app.ts server/test/improvements
git commit -m "feat: improvements module with event-driven suggestion agent"
```

---

### Task 7: Web — wire RiskPage to the API + create form

**Files:**
- Create: `web/src/app/risk-api.ts`
- Modify: `web/src/app/RiskPage.tsx`
- Test: `web/test/app/risk.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (`web/src/api.ts`), the risk routes (Task 4).
- Produces: `riskApi(token, workspaceId)` (`list/create/update/close`), a RiskPage driven by real data.

- [ ] **Step 1: Write the failing test**

`web/test/app/risk.test.tsx` (inject a fake `riskApi`): renders RiskPage with fake risks → matrix shows the risk in the right l×i cell + severity legend; clicking "Add risk", filling the form, submitting → `create` called with `{title,likelihood,impact,...}`; on a rejected create, the form values are retained.

- [ ] **Step 2: Run + verify RED** (`npm run test:web -- --run test/app/risk.test.tsx`).

- [ ] **Step 3: Implement `risk-api.ts`** (mirror `web/src/onboarding/api.ts` — `onboardingApi` style; methods call `apiFetch<T>('/api/m/risk/risks', token, {workspaceId, ...})`).

- [ ] **Step 4: Refactor `RiskPage.tsx`** to accept `{ token, workspaceId }` (or an injected `api` prop defaulting to `riskApi`), fetch risks on mount (`useEffect`), keep the existing matrix/severity rendering but map fetched data, and add an Add/Edit form (panel) that calls `create`/`update`. Show a loading + error state. The server `severityBucket` (low<6 / med 6–11 / high 12–14 / ext ≥15) is canonical — confirm the existing in-file `severity()` uses the SAME thresholds and align it if it differs, so the matrix colouring matches the agent's high-severity rule (≥12).

- [ ] **Step 5: Run tests + web build, verify GREEN** (`npm run test:web` + `npm run build --workspace web`; `find web/src web/test -name '*.js'` empty).

- [ ] **Step 6: Commit**

```bash
git add web/src/app/risk-api.ts web/src/app/RiskPage.tsx web/test/app/risk.test.tsx
git commit -m "feat: wire Risk Register page to the API"
```

---

### Task 8: Web — Complaints screen

**Files:**
- Create: `web/src/app/complaints-api.ts`, `web/src/app/ComplaintsPage.tsx`
- Modify: `web/src/Shell.tsx` (render `ComplaintsPage` for `active==='complaints'`)
- Test: `web/test/app/complaints.test.tsx`

**Interfaces:**
- Produces: `complaintsApi(token, workspaceId)` (`list/create/update/resolve`), `ComplaintsPage`.

- [ ] **Step 1: Write failing test** — list renders complaints grouped/filterable by status; intake form submit → `create` called with `{description, channel, ...}`; a resolve action → `resolve(id)` called; dup/empty description blocked (validation message).

- [ ] **Step 2: Run + verify RED.**

- [ ] **Step 3: Implement `complaints-api.ts`** (mirror risk-api).

- [ ] **Step 4: Implement `ComplaintsPage.tsx`** using the design-system panels (see `RiskPage.tsx`/`app/AppChrome.css`): a list with status filter, an intake form, and a detail/resolve panel. Loading + error states.

- [ ] **Step 5: Wire into `Shell.tsx`** — replace the placeholder `ModulePage` for `active==='complaints'` with `<ComplaintsPage token={...} workspaceId={...} />`. (Shell currently renders `ModulePage` for non-hub/risk; add an explicit branch for `complaints`.) Thread `token`/`workspaceId` into Shell (add as props from `App.tsx`, alongside the existing `fetchMe`).

- [ ] **Step 6: Run tests + build, verify GREEN** (don't break existing Shell tests; update them if the Shell props changed — keep assertions honest).

- [ ] **Step 7: Commit**

```bash
git add web/src/app/complaints-api.ts web/src/app/ComplaintsPage.tsx web/src/Shell.tsx web/test/app/complaints.test.tsx
git commit -m "feat: complaints register screen"
```

---

### Task 9: Web — Improvements screen + nav

**Files:**
- Create: `web/src/app/improvements-api.ts`, `web/src/app/ImprovementsPage.tsx`
- Modify: `web/src/Shell.tsx` (add nav item + render branch)
- Test: `web/test/app/improvements.test.tsx`

**Interfaces:**
- Produces: `improvementsApi(token, workspaceId)` (`list/create/setStatus`), `ImprovementsPage`.

- [ ] **Step 1: Write failing test** — list shows auto vs manual badge + status; manual create form → `create` called; status action (actioned/dismissed/done) → `setStatus(id,status)` called.

- [ ] **Step 2: Run + verify RED.**

- [ ] **Step 3: Implement `improvements-api.ts`.**

- [ ] **Step 4: Implement `ImprovementsPage.tsx`** (design-system; list grouped by status, source badges, manual create, status buttons).

- [ ] **Step 5: Wire `Shell.tsx`** — add a nav item `{ id:'improvements', label:'Improvements', code:'IMP', group:'modules' }` and a render branch for `active==='improvements'`.

- [ ] **Step 6: Run tests + build, verify GREEN.**

- [ ] **Step 7: Commit**

```bash
git add web/src/app/improvements-api.ts web/src/app/ImprovementsPage.tsx web/src/Shell.tsx web/test/app/improvements.test.tsx
git commit -m "feat: improvements register screen + nav"
```

---

### Task 10: Live integration test + final scope/security verification

**Files:**
- Create: `server/test/integration/sp3-modules.test.ts`

**Interfaces:** Produces a release-ready SP-3 branch.

- [ ] **Step 1: Write the live integration test (real Supabase)**

Following `server/test/integration/onboarding.test.ts` (create users via `serviceClient.auth.admin.createUser`, sign in via `anonClient`): create an owner + workspace; through the real risk/complaints/improvements services + stores (service-role + the real `publish`/dispatch + registered subscriber):
- create 3 complaints in the same `category` → after the 3rd, an `improvements` row with `trigger_kind='recurring_complaints'` exists (and a 4th complaint does NOT create a duplicate open suggestion);
- create a risk with likelihood×impact ≥ 12, status 'open', no treatment → an `untreated_high_risk` suggestion exists; add treatment → that suggestion becomes `done`;
- a second tenant's user (JWT-scoped client) sees zero of the first tenant's risks/complaints/improvements (cross-tenant isolation).
Add `afterAll` cleanup (delete created users/workspaces).

- [ ] **Step 2: Run the live test, verify GREEN**

Run: `npm run db:reset && npm run test:int --workspace server`
Expected: PASS.

- [ ] **Step 3: Focused security/scope searches**

Run:
```bash
rg -n "from\\('(business_rules|business_profile|compliance_obligations|org_people|risk_frameworks)'\\)" server/src/modules/risk server/src/modules/complaints server/src/modules/improvements
rg -n "Quantara|Neural Workflow|multifractal|biometric" server/src/modules web/src/app --glob '!*.test.*'
```
Expected: modules do NOT write Hub business-context tables (reads/links only via `context_links`); no Quantara coupling. Confirm no module imports another module's store.

- [ ] **Step 4: Run the complete verification matrix**

```bash
npm run db:reset
for f in supabase/tests/*.sql; do psql postgresql://postgres:postgres@127.0.0.1:54332/postgres -Xq -f "$f" 2>&1 | grep -E "not ok|ERROR"; done   # expect none
npm test
npm run build --workspace server
npm run build --workspace web
npm run test:int --workspace server
git diff --check
```
Expected: all green; `find web/src web/test -name '*.js'` empty; clean worktree.

- [ ] **Step 5: Handle findings** — if verification changes a file, return to its task, rerun that task's focused test, and amend that task's commit. If nothing changes, create no commit.

---

## Notes for the executor

- The local `supabase test db` CLI is broken — always run pgTAP via psql as shown. CI runs the real gate.
- Inject `now`/clocks and the `publish` dependency; never call `Date.now()` inside rule logic (keeps the subscriber tests deterministic).
- Mirror the onboarding module for any mechanical detail not spelled out here; do not invent new conventions.
