# SP-1: Context Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build BYB's Context Hub — 8 versioned/audited, RLS-scoped entities with DB-enforced versioning+audit+event-outbox, a typed Context API over a generic core, cross-entity links, an in-process event dispatcher, and deterministic conflict detection — plus the SP-0 middleware-seam fix.

**Architecture:** Per-entity typed Postgres tables share a generic versioned base; two generic triggers (`hub_before_write`, `hub_after_write`) make every write bump `version`, snapshot into `entity_versions`, and enqueue a `context_events` outbox row — un-bypassable. A TypeScript `ContextHub` facade wraps a generic `hubRepository` over an injectable `HubStore` (real impl over `userScopedClient`, so RLS applies). Conflict detection is a Postgres function; the event dispatcher drains the outbox to in-process subscribers.

**Tech Stack:** Supabase Postgres + RLS + pgTAP, Node/Express + TypeScript (strict, ESM), `@supabase/supabase-js`, Vitest.

## Global Constraints

- Native Postgres + RLS on **every** tenant table, with a passing pgTAP cross-tenant isolation test before merge.
- Dedicated Supabase ports: api `54331`, db `54332`, studio `54333`. Local `supabase start` needs `--exclude vector,mailpit,storage-api,logflare` (clean CI does not). Never touch the separate "Cinder" project.
- TypeScript strict + ESM; local imports use `.js` extensions.
- All Postgres functions/triggers that write are `SECURITY DEFINER set search_path = public` and read identity via `auth.uid()`.
- RLS-sensitive server queries use `userScopedClient(config, accessToken)` (carries the user JWT) — never anon/service.
- Entities **deprecate (status='archived'), never DELETE**; `context_links` may be hard-deleted (metadata).
- Conventional commits. Work on branch `sp-1-context-hub` (off `main`), not committed straight to `main`.
- `entity_status` enum = `('draft','active','archived')`. The 8 entity tables: `business_profile, business_rules, compliance_obligations, internal_processes, decision_logic, risk_frameworks, governance, org_people`.

---

## File Structure

```
supabase/migrations/
  0007_context_hub_entities.sql      # entity_status enum, 8 entity tables, base cols, indexes, RLS
  0008_context_hub_support.sql       # entity_versions, context_events, context_links + RLS
  0009_context_hub_triggers.sql      # hub_before_write + hub_after_write + attach to all 8
  0010_context_rule_conflicts.sql    # context_rule_conflicts(ws) function
supabase/tests/
  context_hub_isolation_test.sql     # cross-tenant isolation across all 11 Hub tables
  context_hub_versioning_test.sql    # trigger: version bump + snapshot + outbox row
  context_rule_conflicts_test.sql    # duplicate / divergent / clean
server/src/middleware/authed-workspace.ts   # Task 0 composed helper
server/src/context/
  types.ts            # EntityStatus, HubRow, domain types, HubStore interface
  hub-repository.ts   # generic CRUD core over HubStore
  supabase-store.ts   # HubStore + EventStore impls over supabase-js
  entities.ts         # typed per-entity wrappers
  links.ts            # connect/list/disconnect
  events.ts           # registry + dispatchPendingEvents
  conflicts.ts        # ruleConflicts() RPC wrapper
  index.ts            # ContextHub facade
server/test/context/*.test.ts
server/test/integration/round-trip.test.ts   # live-stack smoke (separate command)
```

---

### Task 0: Middleware-seam fix

**Files:**
- Create: `server/src/middleware/authed-workspace.ts`, `server/test/authed-workspace.test.ts`
- Modify: `server/src/middleware/require-workspace.ts` (add fail-loud guard)

**Interfaces:**
- Consumes: `requireAuth(deps)`, `RequireAuthDeps` (require-auth.ts); `requireWorkspace(deps)`, `RequireWorkspaceDeps` (require-workspace.ts).
- Produces: `authedWorkspaceRoute(deps: { auth: RequireAuthDeps; workspace: RequireWorkspaceDeps }): RequestHandler[]`.

- [ ] **Step 1: Write the failing tests**

`server/test/authed-workspace.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { authedWorkspaceRoute } from '../src/middleware/authed-workspace.js'
import { requireWorkspace } from '../src/middleware/require-workspace.js'

describe('authedWorkspaceRoute', () => {
  it('returns [requireAuth, requireWorkspace] in order', () => {
    const handlers = authedWorkspaceRoute({
      auth: { getUser: async () => null },
      workspace: { getMembership: async () => null },
    })
    expect(handlers).toHaveLength(2)
    expect(typeof handlers[0]).toBe('function')
    expect(typeof handlers[1]).toBe('function')
  })
})

describe('requireWorkspace fail-loud guard', () => {
  it('500s when req.user/accessToken is missing (auth did not run)', async () => {
    const app = express()
    // NOTE: no auth middleware sets req.user — simulates a wiring bug
    app.get('/x', requireWorkspace({ getMembership: async () => ({ role: 'staff', permissions: {} }) }),
      (_req, res) => res.json({ ok: true }))
    const res = await request(app).get('/x').set('x-workspace-id', 'ws1')
    expect(res.status).toBe(500)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:server`
Expected: FAIL — cannot find `../src/middleware/authed-workspace.js`.

- [ ] **Step 3: Add the guard and the helper**

In `server/src/middleware/require-workspace.ts`, inside the handler returned by `requireWorkspace`, add as the FIRST lines of the async handler (before reading `x-workspace-id`):
```ts
    if (!req.user || !req.accessToken) {
      return res.status(500).json({ error: 'requireWorkspace requires requireAuth to run first' })
    }
```

Create `server/src/middleware/authed-workspace.ts`:
```ts
import type { RequestHandler } from 'express'
import { requireAuth, type RequireAuthDeps } from './require-auth.js'
import { requireWorkspace, type RequireWorkspaceDeps } from './require-workspace.js'

export function authedWorkspaceRoute(deps: {
  auth: RequireAuthDeps
  workspace: RequireWorkspaceDeps
}): RequestHandler[] {
  return [requireAuth(deps.auth), requireWorkspace(deps.workspace)]
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:server`
Expected: PASS — new tests pass; existing `require-workspace` tests still pass (they set `req.user`/`req.accessToken`).

- [ ] **Step 5: Commit**

```bash
git add server/src/middleware/authed-workspace.ts server/src/middleware/require-workspace.ts server/test/authed-workspace.test.ts
git commit -m "feat: composed authedWorkspaceRoute + fail-loud guard in requireWorkspace"
```

---

### Task 1: Entity schema migration (0007)

**Files:**
- Create: `supabase/migrations/0007_context_hub_entities.sql`, `supabase/tests/context_hub_isolation_test.sql`

**Interfaces:**
- Produces: `entity_status` enum; 8 entity tables with the shared base columns + entity-specific columns + RLS membership-scoped policies; partial unique index on `business_profile(workspace_id) where status='active'`.

- [ ] **Step 1: Write the failing test**

`supabase/tests/context_hub_isolation_test.sql`:
```sql
-- context_hub_isolation_test.sql — cross-tenant isolation across Hub tables
begin;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1','f1@test.dev'),
  ('00000000-0000-0000-0000-0000000000f2','f2@test.dev');
insert into workspaces (id, name, slug) values
  ('ffffffff-0000-0000-0000-000000000001','F1 Co','f1-co'),
  ('ffffffff-0000-0000-0000-000000000002','F2 Co','f2-co');
insert into workspace_members (workspace_id, user_id, role) values
  ('ffffffff-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000f1','owner'),
  ('ffffffff-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000f2','owner');

-- seed one row per entity in F2 (insert as superuser; triggers from Task 3 not yet present)
insert into business_profile (workspace_id, name) values ('ffffffff-0000-0000-0000-000000000002','F2 profile');
insert into business_rules (workspace_id, rule_type, area, statement) values ('ffffffff-0000-0000-0000-000000000002','must_do','hr','x');
insert into compliance_obligations (workspace_id, name) values ('ffffffff-0000-0000-0000-000000000002','WHS');
insert into internal_processes (workspace_id, title) values ('ffffffff-0000-0000-0000-000000000002','Onboard');
insert into decision_logic (workspace_id, name) values ('ffffffff-0000-0000-0000-000000000002','Approve');
insert into risk_frameworks (workspace_id, name) values ('ffffffff-0000-0000-0000-000000000002','Ops risk');
insert into governance (workspace_id, name, kind) values ('ffffffff-0000-0000-0000-000000000002','Board','committee');
insert into org_people (workspace_id, person_name) values ('ffffffff-0000-0000-0000-000000000002','Jane');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

select is((select count(*)::int from business_profile       where workspace_id='ffffffff-0000-0000-0000-000000000002'),0,'iso business_profile');
select is((select count(*)::int from business_rules         where workspace_id='ffffffff-0000-0000-0000-000000000002'),0,'iso business_rules');
select is((select count(*)::int from compliance_obligations where workspace_id='ffffffff-0000-0000-0000-000000000002'),0,'iso compliance_obligations');
select is((select count(*)::int from internal_processes     where workspace_id='ffffffff-0000-0000-0000-000000000002'),0,'iso internal_processes');
select is((select count(*)::int from decision_logic         where workspace_id='ffffffff-0000-0000-0000-000000000002'),0,'iso decision_logic');
select is((select count(*)::int from risk_frameworks        where workspace_id='ffffffff-0000-0000-0000-000000000002'),0,'iso risk_frameworks');
select is((select count(*)::int from governance             where workspace_id='ffffffff-0000-0000-0000-000000000002'),0,'iso governance');
select is((select count(*)::int from org_people             where workspace_id='ffffffff-0000-0000-0000-000000000002'),0,'iso org_people');

select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run db:reset && npm run db:test`
Expected: FAIL — `relation "business_profile" does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/0007_context_hub_entities.sql`:
```sql
-- 0007_context_hub_entities.sql — Context Hub entity tables
create type entity_status as enum ('draft','active','archived');

-- helper: apply once per table after creation
-- base columns: id, workspace_id, version, status, created_by/at, updated_by/at, approved_by/at, supersedes

create table business_profile (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  version int not null default 1,
  status entity_status not null default 'draft',
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz,
  supersedes uuid,
  name text not null,
  anzsic_code text, anzsic_label text, size text,
  jurisdiction text check (jurisdiction in ('AU','NZ')),
  description text
);
create unique index business_profile_active_uniq on business_profile (workspace_id) where status = 'active';

create table business_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  version int not null default 1,
  status entity_status not null default 'draft',
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz,
  supersedes uuid,
  rule_type text not null check (rule_type in ('business_rule','value_setting','must_do')),
  area text not null,
  statement text not null,
  operator text,
  value jsonb,
  consequence text,
  applies_to jsonb not null default '[]'::jsonb
);
create index business_rules_ws_area on business_rules (workspace_id, area);

create table compliance_obligations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  version int not null default 1,
  status entity_status not null default 'draft',
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz,
  supersedes uuid,
  name text not null,
  description text,
  source text check (source in ('australian_law','state_regulation','custom')),
  reference text,
  anzsic_code text,
  subscribe_updates boolean not null default false
);

create table internal_processes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  version int not null default 1,
  status entity_status not null default 'draft',
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz,
  supersedes uuid,
  title text not null,
  area text, role text, frequency text,
  steps jsonb not null default '[]'::jsonb,
  faqs jsonb not null default '[]'::jsonb
);

create table decision_logic (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  version int not null default 1,
  status entity_status not null default 'draft',
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz,
  supersedes uuid,
  name text not null,
  description text,
  logic jsonb not null default '{}'::jsonb
);

create table risk_frameworks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  version int not null default 1,
  status entity_status not null default 'draft',
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz,
  supersedes uuid,
  name text not null,
  categories jsonb not null default '[]'::jsonb,
  appetite jsonb not null default '{}'::jsonb,
  matrix_config jsonb not null default '{}'::jsonb
);

create table governance (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  version int not null default 1,
  status entity_status not null default 'draft',
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz,
  supersedes uuid,
  name text not null,
  kind text not null check (kind in ('committee','authority','escalation_path')),
  members jsonb not null default '[]'::jsonb,
  details jsonb not null default '{}'::jsonb
);

create table org_people (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  version int not null default 1,
  status entity_status not null default 'draft',
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz,
  supersedes uuid,
  person_name text not null,
  title text, email text,
  responsibilities jsonb not null default '[]'::jsonb,
  member_user_id uuid references auth.users(id) on delete set null,
  access_scope jsonb not null default '{}'::jsonb
);

-- RLS: membership-scoped on all 8
do $$
declare t text;
begin
  foreach t in array array['business_profile','business_rules','compliance_obligations',
    'internal_processes','decision_logic','risk_frameworks','governance','org_people']
  loop
    execute format('alter table %I enable row level security', t);
    execute format($f$create policy %1$s_rw on %1$s for all
      using (public.is_workspace_member(workspace_id))
      with check (public.is_workspace_member(workspace_id))$f$, t);
  end loop;
end $$;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run db:reset && npm run db:test`
Expected: PASS — `context_hub_isolation_test` 8/8; all earlier pgTAP tests still pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0007_context_hub_entities.sql supabase/tests/context_hub_isolation_test.sql
git commit -m "feat: Context Hub entity tables with membership-scoped RLS"
```

---

### Task 2: Support tables — versions, events, links (0008)

**Files:**
- Create: `supabase/migrations/0008_context_hub_support.sql`
- Modify: `supabase/tests/context_hub_isolation_test.sql` (extend to 11 assertions)

**Interfaces:**
- Produces: `entity_versions`, `context_events`, `context_links` tables + membership-scoped RLS.

- [ ] **Step 1: Extend the isolation test (failing)**

In `supabase/tests/context_hub_isolation_test.sql`: change `select plan(8);` → `select plan(11);`; add seeds for the three tables in F2 BEFORE the role switch:
```sql
insert into entity_versions (workspace_id, entity_type, entity_id, version, snapshot, status)
  values ('ffffffff-0000-0000-0000-000000000002','business_rules', gen_random_uuid(), 1, '{}'::jsonb, 'active');
insert into context_events (workspace_id, type, entity_type, entity_id)
  values ('ffffffff-0000-0000-0000-000000000002','business_rules.insert','business_rules', gen_random_uuid());
insert into context_links (workspace_id, from_type, from_id, to_type, to_id)
  values ('ffffffff-0000-0000-0000-000000000002','business_rules', gen_random_uuid(),'compliance_obligations', gen_random_uuid());
```
and after the existing 8 assertions add:
```sql
select is((select count(*)::int from entity_versions where workspace_id='ffffffff-0000-0000-0000-000000000002'),0,'iso entity_versions');
select is((select count(*)::int from context_events  where workspace_id='ffffffff-0000-0000-0000-000000000002'),0,'iso context_events');
select is((select count(*)::int from context_links   where workspace_id='ffffffff-0000-0000-0000-000000000002'),0,'iso context_links');
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run db:reset && npm run db:test`
Expected: FAIL — `relation "entity_versions" does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/0008_context_hub_support.sql`:
```sql
-- 0008_context_hub_support.sql — versions, outbox, links
create table entity_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  version int not null,
  snapshot jsonb not null,
  status entity_status not null,
  actor uuid,
  created_at timestamptz not null default now()
);
create index entity_versions_lookup on entity_versions (workspace_id, entity_type, entity_id, version);

create table context_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  type text not null,
  entity_type text not null,
  entity_id uuid not null,
  before jsonb,
  after jsonb,
  actor uuid,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz
);
create index context_events_pending on context_events (created_at) where dispatched_at is null;

create table context_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  from_type text not null, from_id uuid not null,
  to_type text not null, to_id uuid not null,
  relation text,
  created_by uuid, created_at timestamptz not null default now(),
  unique (workspace_id, from_type, from_id, to_type, to_id, relation)
);

do $$
declare t text;
begin
  foreach t in array array['entity_versions','context_events','context_links']
  loop
    execute format('alter table %I enable row level security', t);
    execute format($f$create policy %1$s_rw on %1$s for all
      using (public.is_workspace_member(workspace_id))
      with check (public.is_workspace_member(workspace_id))$f$, t);
  end loop;
end $$;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run db:reset && npm run db:test`
Expected: PASS — `context_hub_isolation_test` 11/11; all earlier tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0008_context_hub_support.sql supabase/tests/context_hub_isolation_test.sql
git commit -m "feat: entity_versions, context_events outbox, and context_links"
```

---

### Task 3: Versioning + outbox triggers (0009)

**Files:**
- Create: `supabase/migrations/0009_context_hub_triggers.sql`, `supabase/tests/context_hub_versioning_test.sql`

**Interfaces:**
- Produces: `hub_before_write()`, `hub_after_write()` functions + BEFORE and AFTER row triggers on all 8 entity tables.

- [ ] **Step 1: Write the failing test**

`supabase/tests/context_hub_versioning_test.sql`:
```sql
begin;
select plan(6);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a7','a7@test.dev');
insert into workspaces (id, name, slug) values ('a7777777-0000-0000-0000-000000000001','A7 Co','a7-co');
insert into workspace_members (workspace_id, user_id, role)
  values ('a7777777-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a7','owner');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a7","role":"authenticated"}';

-- INSERT
insert into business_rules (workspace_id, rule_type, area, statement)
  values ('a7777777-0000-0000-0000-000000000001','must_do','finance','rule one');

select is((select version from business_rules where statement='rule one'), 1, 'insert sets version 1');
select is((select created_by from business_rules where statement='rule one'),
          '00000000-0000-0000-0000-0000000000a7'::uuid, 'insert stamps created_by');
select is((select count(*)::int from entity_versions
           where entity_type='business_rules' and version=1), 1, 'insert writes a version snapshot');
select is((select count(*)::int from context_events
           where type='business_rules.insert'), 1, 'insert enqueues an outbox event');

-- UPDATE
update business_rules set consequence='approval' where statement='rule one';
select is((select version from business_rules where statement='rule one'), 2, 'update bumps version to 2');
select is((select count(*)::int from context_events where type='business_rules.update'), 1, 'update enqueues an event');

select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run db:reset && npm run db:test`
Expected: FAIL — `context_hub_versioning_test` fails (version stays at insert default / no version or event rows).

- [ ] **Step 3: Write the migration**

`supabase/migrations/0009_context_hub_triggers.sql`:
```sql
-- 0009_context_hub_triggers.sql — DB-enforced versioning, audit, outbox
create or replace function public.hub_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    NEW.version := 1;
    if NEW.created_by is null then NEW.created_by := auth.uid(); end if;
    NEW.updated_by := auth.uid();
    NEW.created_at := coalesce(NEW.created_at, now());
    NEW.updated_at := now();
    if NEW.status = 'active' and NEW.approved_by is null then
      NEW.approved_by := auth.uid(); NEW.approved_at := now();
    end if;
  elsif TG_OP = 'UPDATE' then
    NEW.version := OLD.version + 1;
    NEW.updated_by := auth.uid();
    NEW.updated_at := now();
    if NEW.status = 'active' and OLD.status is distinct from 'active' then
      NEW.approved_by := auth.uid(); NEW.approved_at := now();
    end if;
  end if;
  return NEW;
end $$;

create or replace function public.hub_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into entity_versions(workspace_id, entity_type, entity_id, version, snapshot, status, actor)
    values (NEW.workspace_id, TG_TABLE_NAME, NEW.id, NEW.version, to_jsonb(NEW), NEW.status, auth.uid());
  insert into context_events(workspace_id, type, entity_type, entity_id, before, after, actor)
    values (NEW.workspace_id, TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME, NEW.id,
            case when TG_OP = 'UPDATE' then to_jsonb(OLD) else null end, to_jsonb(NEW), auth.uid());
  return NEW;
end $$;

do $$
declare t text;
begin
  foreach t in array array['business_profile','business_rules','compliance_obligations',
    'internal_processes','decision_logic','risk_frameworks','governance','org_people']
  loop
    execute format('create trigger %1$s_before before insert or update on %1$s
      for each row execute function public.hub_before_write()', t);
    execute format('create trigger %1$s_after after insert or update on %1$s
      for each row execute function public.hub_after_write()', t);
  end loop;
end $$;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run db:reset && npm run db:test`
Expected: PASS — `context_hub_versioning_test` 6/6; isolation + earlier tests still pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0009_context_hub_triggers.sql supabase/tests/context_hub_versioning_test.sql
git commit -m "feat: DB-enforced versioning, audit, and outbox triggers"
```

---

### Task 4: Conflict-detection function (0010)

**Files:**
- Create: `supabase/migrations/0010_context_rule_conflicts.sql`, `supabase/tests/context_rule_conflicts_test.sql`

**Interfaces:**
- Produces: `context_rule_conflicts(ws uuid) returns table(rule_a uuid, rule_b uuid, kind text)`.

- [ ] **Step 1: Write the failing test**

`supabase/tests/context_rule_conflicts_test.sql`:
```sql
begin;
select plan(3);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c7','c7@test.dev');
insert into workspaces (id, name, slug) values ('c7777777-0000-0000-0000-000000000001','C7 Co','c7-co');
insert into workspace_members (workspace_id, user_id, role)
  values ('c7777777-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c7','owner');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000c7","role":"authenticated"}';

-- base rule (active)
insert into business_rules (workspace_id, status, rule_type, area, statement, value, consequence, applies_to)
  values ('c7777777-0000-0000-0000-000000000001','active','value_setting','purchasing','max purchase',
          '1000'::jsonb,'approval','["manager"]'::jsonb);
-- divergent: same area+statement+overlap, different value
insert into business_rules (workspace_id, status, rule_type, area, statement, value, consequence, applies_to)
  values ('c7777777-0000-0000-0000-000000000001','active','value_setting','purchasing','max purchase',
          '2000'::jsonb,'approval','["manager","lead"]'::jsonb);
-- duplicate: identical value+consequence
insert into business_rules (workspace_id, status, rule_type, area, statement, value, consequence, applies_to)
  values ('c7777777-0000-0000-0000-000000000001','active','value_setting','purchasing','max purchase',
          '1000'::jsonb,'approval','["manager"]'::jsonb);
-- unrelated: different area -> no conflict
insert into business_rules (workspace_id, status, rule_type, area, statement, applies_to)
  values ('c7777777-0000-0000-0000-000000000001','active','must_do','safety','wear ppe','["staff"]'::jsonb);

select is((select count(*)::int from context_rule_conflicts('c7777777-0000-0000-0000-000000000001')),
          3, 'three conflicting pairs among the 3 purchasing rules');
select is((select count(*)::int from context_rule_conflicts('c7777777-0000-0000-0000-000000000001') where kind='divergent'),
          2, 'two divergent pairs (the 2000 rule vs each 1000 rule)');
select is((select count(*)::int from context_rule_conflicts('c7777777-0000-0000-0000-000000000001') where kind='duplicate'),
          1, 'one duplicate pair (the two identical 1000 rules)');

select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run db:reset && npm run db:test`
Expected: FAIL — `function context_rule_conflicts(uuid) does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/0010_context_rule_conflicts.sql`:
```sql
-- 0010_context_rule_conflicts.sql — deterministic, advisory rule-conflict detection
create or replace function public.context_rule_conflicts(ws uuid)
returns table(rule_a uuid, rule_b uuid, kind text)
language sql stable security invoker set search_path = public as $$
  select a.id, b.id,
         case when a.value is not distinct from b.value
                   and a.consequence is not distinct from b.consequence
              then 'duplicate' else 'divergent' end
  from business_rules a
  join business_rules b
    on a.workspace_id = b.workspace_id
   and a.id < b.id
   and a.area = b.area
   and lower(btrim(a.statement)) = lower(btrim(b.statement))
  where a.workspace_id = ws
    and a.status = 'active' and b.status = 'active'
    and exists (
      select 1
      from jsonb_array_elements_text(a.applies_to) x
      join jsonb_array_elements_text(b.applies_to) y on x = y
    );
$$;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run db:reset && npm run db:test`
Expected: PASS — `context_rule_conflicts_test` 3/3; all earlier pgTAP tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0010_context_rule_conflicts.sql supabase/tests/context_rule_conflicts_test.sql
git commit -m "feat: deterministic advisory rule-conflict detection function"
```

---

### Task 5: TS types + HubStore + generic repository

**Files:**
- Create: `server/src/context/types.ts`, `server/src/context/hub-repository.ts`, `server/test/context/hub-repository.test.ts`

**Interfaces:**
- Produces:
  - `type EntityStatus = 'draft'|'active'|'archived'`; `interface HubRow { id; workspace_id; version; status; created_by; created_at; updated_by; updated_at; approved_by; approved_at; supersedes; [k:string]: unknown }`.
  - `interface HubStore { insert(table,row); update(table,id,patch); getById(table,id); select(table,filters) }` (all async, return `HubRow`/`HubRow[]`/`HubRow|null`).
  - `hubRepository<T extends HubRow>(table: string)` → `{ list(store, workspaceId, filters?), get(store, id), upsert(store, input), approve(store, id), deprecate(store, id) }`.

- [ ] **Step 1: Write the failing test**

`server/test/context/hub-repository.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { hubRepository } from '../../src/context/hub-repository.js'
import type { HubStore, HubRow } from '../../src/context/types.js'

function fakeStore() {
  const calls: any[] = []
  const store: HubStore = {
    async insert(table, row) { calls.push(['insert', table, row]); return { id: 'new', ...row } as HubRow },
    async update(table, id, patch) { calls.push(['update', table, id, patch]); return { id, ...patch } as HubRow },
    async getById(table, id) { calls.push(['getById', table, id]); return { id } as HubRow },
    async select(table, filters) { calls.push(['select', table, filters]); return [] },
  }
  return { store, calls }
}

describe('hubRepository', () => {
  const repo = hubRepository('business_rules')

  it('upsert without id inserts (workspace_id preserved, no server fields)', async () => {
    const { store, calls } = fakeStore()
    await repo.upsert(store, { workspace_id: 'w1', area: 'hr' })
    expect(calls[0]).toEqual(['insert', 'business_rules', { workspace_id: 'w1', area: 'hr' }])
  })
  it('upsert with id updates and strips id from patch', async () => {
    const { store, calls } = fakeStore()
    await repo.upsert(store, { id: 'r1', area: 'finance' })
    expect(calls[0]).toEqual(['update', 'business_rules', 'r1', { area: 'finance' }])
  })
  it('deprecate sets status archived', async () => {
    const { store, calls } = fakeStore()
    await repo.deprecate(store, 'r1')
    expect(calls[0]).toEqual(['update', 'business_rules', 'r1', { status: 'archived' }])
  })
  it('approve sets status active', async () => {
    const { store, calls } = fakeStore()
    await repo.approve(store, 'r1')
    expect(calls[0]).toEqual(['update', 'business_rules', 'r1', { status: 'active' }])
  })
  it('list passes workspace_id and filters', async () => {
    const { store, calls } = fakeStore()
    await repo.list(store, 'w1', { area: 'hr' })
    expect(calls[0]).toEqual(['select', 'business_rules', { workspace_id: 'w1', area: 'hr' }])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:server`
Expected: FAIL — cannot find `../../src/context/hub-repository.js`.

- [ ] **Step 3: Implement types and repository**

`server/src/context/types.ts`:
```ts
export type EntityStatus = 'draft' | 'active' | 'archived'

export interface HubRow {
  id: string
  workspace_id: string
  version: number
  status: EntityStatus
  created_by: string | null
  created_at: string
  updated_by: string | null
  updated_at: string
  approved_by: string | null
  approved_at: string | null
  supersedes: string | null
  [k: string]: unknown
}

export interface HubStore {
  insert(table: string, row: Record<string, unknown>): Promise<HubRow>
  update(table: string, id: string, patch: Record<string, unknown>): Promise<HubRow>
  getById(table: string, id: string): Promise<HubRow | null>
  select(table: string, filters: Record<string, unknown>): Promise<HubRow[]>
}
```

`server/src/context/hub-repository.ts`:
```ts
import type { HubRow, HubStore } from './types.js'

export function hubRepository<T extends HubRow>(table: string) {
  return {
    list: (store: HubStore, workspaceId: string, filters: Record<string, unknown> = {}) =>
      store.select(table, { workspace_id: workspaceId, ...filters }) as Promise<T[]>,
    get: (store: HubStore, id: string) => store.getById(table, id) as Promise<T | null>,
    upsert: (store: HubStore, input: Record<string, unknown> & { id?: string }) => {
      const { id, ...rest } = input
      return (id ? store.update(table, id, rest) : store.insert(table, rest)) as Promise<T>
    },
    approve: (store: HubStore, id: string) => store.update(table, id, { status: 'active' }) as Promise<T>,
    deprecate: (store: HubStore, id: string) => store.update(table, id, { status: 'archived' }) as Promise<T>,
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:server`
Expected: PASS — all `hubRepository` cases; existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/context/types.ts server/src/context/hub-repository.ts server/test/context/hub-repository.test.ts
git commit -m "feat: Context Hub types, HubStore interface, generic repository core"
```

---

### Task 6: Typed entity wrappers, links, conflicts, supabase store, facade

**Files:**
- Create: `server/src/context/entities.ts`, `server/src/context/links.ts`, `server/src/context/conflicts.ts`, `server/src/context/supabase-store.ts`, `server/src/context/index.ts`, `server/test/context/facade.test.ts`

**Interfaces:**
- Consumes: `hubRepository` (Task 5), `userScopedClient` (server/src/supabase.ts), `SupabaseClient`.
- Produces:
  - `entities.ts`: `rules, profile, obligations, processes, decisionLogic, riskFrameworks, governance, people` (each `hubRepository(<table>)`), with domain type aliases.
  - `links.ts`: `connect(store, link)`, `list(store, workspaceId, ref?)`, `disconnect(store, id)` over a `LinkStore` interface.
  - `conflicts.ts`: `ruleConflicts(db, ws)` → `{ rule_a; rule_b; kind: 'duplicate'|'divergent' }[]` via `db.rpc`.
  - `supabase-store.ts`: `supabaseHubStore(db): HubStore`, `supabaseLinkStore(db): LinkStore`, `supabaseEventStore(db): EventStore`.
  - `index.ts`: `ContextHub` facade object exposing the 8 entity wrappers + `links` + `rules.conflicts`.

- [ ] **Step 1: Write the failing test**

`server/test/context/facade.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { ContextHub } from '../../src/context/index.js'
import type { HubStore } from '../../src/context/types.js'

function recordingStore() {
  const calls: any[] = []
  const store: HubStore = {
    async insert(t, r) { calls.push(['insert', t, r]); return { id: 'x', ...r } as any },
    async update(t, id, p) { calls.push(['update', t, id, p]); return { id, ...p } as any },
    async getById(t, id) { calls.push(['getById', t, id]); return null },
    async select(t, f) { calls.push(['select', t, f]); return [] },
  }
  return { store, calls }
}

describe('ContextHub facade', () => {
  it('exposes all 8 entity wrappers + links', () => {
    for (const k of ['profile','rules','obligations','processes','decisionLogic','riskFrameworks','governance','people'])
      expect(ContextHub).toHaveProperty(k)
    expect(ContextHub.links).toBeDefined()
  })
  it('each wrapper targets its own table', async () => {
    const map: [any, string][] = [
      [ContextHub.profile, 'business_profile'], [ContextHub.rules, 'business_rules'],
      [ContextHub.obligations, 'compliance_obligations'], [ContextHub.processes, 'internal_processes'],
      [ContextHub.decisionLogic, 'decision_logic'], [ContextHub.riskFrameworks, 'risk_frameworks'],
      [ContextHub.governance, 'governance'], [ContextHub.people, 'org_people'],
    ]
    for (const [wrapper, table] of map) {
      const { store, calls } = recordingStore()
      await wrapper.upsert(store, { workspace_id: 'w1' })
      expect(calls[0]).toEqual(['insert', table, { workspace_id: 'w1' }])
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:server`
Expected: FAIL — cannot find `../../src/context/index.js`.

- [ ] **Step 3: Implement the files**

`server/src/context/entities.ts`:
```ts
import { hubRepository } from './hub-repository.js'
import type { HubRow } from './types.js'

export type BusinessProfile = HubRow & { name: string; anzsic_code: string | null; jurisdiction: 'AU' | 'NZ' | null }
export type BusinessRule = HubRow & { rule_type: string; area: string; statement: string; value: unknown; consequence: string | null; applies_to: string[] }
export type ComplianceObligation = HubRow & { name: string; source: string | null }
export type InternalProcess = HubRow & { title: string; steps: unknown[] }
export type DecisionLogic = HubRow & { name: string; logic: unknown }
export type RiskFramework = HubRow & { name: string; matrix_config: unknown }
export type Governance = HubRow & { name: string; kind: string }
export type OrgPerson = HubRow & { person_name: string; email: string | null; responsibilities: unknown[] }

export const profile = hubRepository<BusinessProfile>('business_profile')
export const rules = hubRepository<BusinessRule>('business_rules')
export const obligations = hubRepository<ComplianceObligation>('compliance_obligations')
export const processes = hubRepository<InternalProcess>('internal_processes')
export const decisionLogic = hubRepository<DecisionLogic>('decision_logic')
export const riskFrameworks = hubRepository<RiskFramework>('risk_frameworks')
export const governance = hubRepository<Governance>('governance')
export const people = hubRepository<OrgPerson>('org_people')
```

`server/src/context/links.ts`:
```ts
export interface LinkRef { type: string; id: string }
export interface ContextLink {
  id: string; workspace_id: string
  from_type: string; from_id: string; to_type: string; to_id: string
  relation: string | null; created_at: string
}
export interface LinkStore {
  insertLink(row: Record<string, unknown>): Promise<ContextLink>
  selectLinks(workspaceId: string, ref?: LinkRef): Promise<ContextLink[]>
  deleteLink(id: string): Promise<void>
}

export const links = {
  connect: (store: LinkStore, link: { workspace_id: string; from: LinkRef; to: LinkRef; relation?: string }) =>
    store.insertLink({
      workspace_id: link.workspace_id,
      from_type: link.from.type, from_id: link.from.id,
      to_type: link.to.type, to_id: link.to.id,
      relation: link.relation ?? null,
    }),
  list: (store: LinkStore, workspaceId: string, ref?: LinkRef) => store.selectLinks(workspaceId, ref),
  disconnect: (store: LinkStore, id: string) => store.deleteLink(id),
}
```

`server/src/context/conflicts.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface RuleConflict { rule_a: string; rule_b: string; kind: 'duplicate' | 'divergent' }

export async function ruleConflicts(db: SupabaseClient, ws: string): Promise<RuleConflict[]> {
  const { data, error } = await db.rpc('context_rule_conflicts', { ws })
  if (error) throw new Error(`ruleConflicts: ${error.message}`)
  return (data ?? []) as RuleConflict[]
}
```

`server/src/context/supabase-store.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { HubRow, HubStore } from './types.js'
import type { ContextLink, LinkRef, LinkStore } from './links.js'
import type { ContextEvent, EventStore } from './events.js'

export function supabaseHubStore(db: SupabaseClient): HubStore {
  return {
    async insert(table, row) {
      const { data, error } = await db.from(table).insert(row).select().single()
      if (error) throw new Error(`hub insert ${table}: ${error.message}`)
      return data as HubRow
    },
    async update(table, id, patch) {
      const { data, error } = await db.from(table).update(patch).eq('id', id).select().single()
      if (error) throw new Error(`hub update ${table}: ${error.message}`)
      return data as HubRow
    },
    async getById(table, id) {
      const { data, error } = await db.from(table).select('*').eq('id', id).maybeSingle()
      if (error) throw new Error(`hub get ${table}: ${error.message}`)
      return (data as HubRow) ?? null
    },
    async select(table, filters) {
      let q = db.from(table).select('*')
      for (const [k, v] of Object.entries(filters)) q = q.eq(k, v as never)
      const { data, error } = await q
      if (error) throw new Error(`hub select ${table}: ${error.message}`)
      return (data as HubRow[]) ?? []
    },
  }
}

export function supabaseLinkStore(db: SupabaseClient): LinkStore {
  return {
    async insertLink(row) {
      const { data, error } = await db.from('context_links').insert(row).select().single()
      if (error) throw new Error(`link insert: ${error.message}`)
      return data as ContextLink
    },
    async selectLinks(workspaceId, ref?: LinkRef) {
      let q = db.from('context_links').select('*').eq('workspace_id', workspaceId)
      if (ref) q = q.eq('from_type', ref.type).eq('from_id', ref.id)
      const { data, error } = await q
      if (error) throw new Error(`link list: ${error.message}`)
      return (data as ContextLink[]) ?? []
    },
    async deleteLink(id) {
      const { error } = await db.from('context_links').delete().eq('id', id)
      if (error) throw new Error(`link delete: ${error.message}`)
    },
  }
}

export function supabaseEventStore(db: SupabaseClient): EventStore {
  return {
    async pending() {
      const { data, error } = await db.from('context_events').select('*')
        .is('dispatched_at', null).order('created_at', { ascending: true })
      if (error) throw new Error(`events pending: ${error.message}`)
      return (data as ContextEvent[]) ?? []
    },
    async markDispatched(id) {
      const { error } = await db.from('context_events').update({ dispatched_at: new Date().toISOString() }).eq('id', id)
      if (error) throw new Error(`events markDispatched: ${error.message}`)
    },
  }
}
```

`server/src/context/index.ts`:
```ts
import * as entities from './entities.js'
import { links } from './links.js'
import { ruleConflicts } from './conflicts.js'

export const ContextHub = {
  profile: entities.profile,
  rules: Object.assign({}, entities.rules, { conflicts: ruleConflicts }),
  obligations: entities.obligations,
  processes: entities.processes,
  decisionLogic: entities.decisionLogic,
  riskFrameworks: entities.riskFrameworks,
  governance: entities.governance,
  people: entities.people,
  links,
}

export * from './types.js'
export * from './entities.js'
export * from './links.js'
export * from './conflicts.js'
export * from './supabase-store.js'
export * from './events.js'
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:server`
Expected: PASS — facade tests pass. (Note: `events.ts` is created in Task 7; if running this task before Task 7, temporarily omit the `events` re-export and `supabaseEventStore` — but the recommended order is Task 7 before Task 6's `index.ts` event re-export. To keep tasks independent, implement Task 7 first OR create a minimal `events.ts` stub here. This plan orders Task 7 immediately after; if executing strictly in order, add the `events.ts` from Task 7 before this step's `index.ts`.)

- [ ] **Step 5: Commit**

```bash
git add server/src/context/entities.ts server/src/context/links.ts server/src/context/conflicts.ts server/src/context/supabase-store.ts server/src/context/index.ts server/test/context/facade.test.ts
git commit -m "feat: typed entity wrappers, links, conflicts, supabase stores, ContextHub facade"
```

---

### Task 7: Event subscriber registry + dispatcher

**Files:**
- Create: `server/src/context/events.ts`, `server/test/context/events.test.ts`

**Note:** Implement this BEFORE Task 6's `index.ts`/`supabase-store.ts` event imports (they reference `ContextEvent`/`EventStore` from here). If executing strictly in numeric order, create `events.ts` as the first step of Task 6. The two tasks may be merged if your executor prefers.

**Interfaces:**
- Produces:
  - `interface ContextEvent { id; workspace_id; type; entity_type; entity_id; before; after; actor; created_at }`.
  - `interface EventStore { pending(): Promise<ContextEvent[]>; markDispatched(id: string): Promise<void> }`.
  - `type Handler = (e: ContextEvent) => Promise<void>`.
  - `createRegistry()` → `{ on(prefix, handler), handlersFor(type): Handler[] }`.
  - `dispatchPendingEvents(store: EventStore, registry): Promise<number>` (returns count dispatched).

- [ ] **Step 1: Write the failing test**

`server/test/context/events.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createRegistry, dispatchPendingEvents, type ContextEvent, type EventStore } from '../../src/context/events.js'

function ev(id: string, type: string): ContextEvent {
  return { id, workspace_id: 'w', type, entity_type: 'business_rules', entity_id: 'e', before: null, after: {}, actor: null, created_at: id }
}
function memStore(events: ContextEvent[]): EventStore & { dispatched: string[] } {
  const dispatched: string[] = []
  return {
    dispatched,
    async pending() { return events.filter(e => !dispatched.includes(e.id)) },
    async markDispatched(id) { dispatched.push(id) },
  }
}

describe('registry', () => {
  it('matches handlers by type prefix', () => {
    const r = createRegistry()
    const h = vi.fn()
    r.on('business_rules.', h)
    expect(r.handlersFor('business_rules.update')).toEqual([h])
    expect(r.handlersFor('org_people.insert')).toEqual([])
  })
})

describe('dispatchPendingEvents', () => {
  it('invokes matching handlers oldest-first and marks dispatched', async () => {
    const store = memStore([ev('1', 'business_rules.insert'), ev('2', 'business_rules.update')])
    const r = createRegistry()
    const seen: string[] = []
    r.on('business_rules.', async (e) => { seen.push(e.id) })
    const n = await dispatchPendingEvents(store, r)
    expect(n).toBe(2)
    expect(seen).toEqual(['1', '2'])
    expect(store.dispatched).toEqual(['1', '2'])
  })

  it('leaves an event undispatched if its handler throws (retryable)', async () => {
    const store = memStore([ev('1', 'business_rules.insert')])
    const r = createRegistry()
    r.on('business_rules.', async () => { throw new Error('boom') })
    await expect(dispatchPendingEvents(store, r)).rejects.toThrow('boom')
    expect(store.dispatched).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:server`
Expected: FAIL — cannot find `../../src/context/events.js`.

- [ ] **Step 3: Implement**

`server/src/context/events.ts`:
```ts
export interface ContextEvent {
  id: string
  workspace_id: string
  type: string
  entity_type: string
  entity_id: string
  before: unknown
  after: unknown
  actor: string | null
  created_at: string
}

export interface EventStore {
  pending(): Promise<ContextEvent[]>
  markDispatched(id: string): Promise<void>
}

export type Handler = (e: ContextEvent) => Promise<void>

export function createRegistry() {
  const subs: { prefix: string; handler: Handler }[] = []
  return {
    on(prefix: string, handler: Handler) { subs.push({ prefix, handler }) },
    handlersFor(type: string): Handler[] {
      return subs.filter((s) => type.startsWith(s.prefix)).map((s) => s.handler)
    },
  }
}

export type Registry = ReturnType<typeof createRegistry>

export async function dispatchPendingEvents(store: EventStore, registry: Registry): Promise<number> {
  const events = await store.pending()
  let dispatched = 0
  for (const e of events) {
    for (const handler of registry.handlersFor(e.type)) {
      await handler(e) // throw → propagate; event stays undispatched (at-least-once)
    }
    await store.markDispatched(e.id)
    dispatched++
  }
  return dispatched
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:server`
Expected: PASS — registry + dispatcher cases.

- [ ] **Step 5: Commit**

```bash
git add server/src/context/events.ts server/test/context/events.test.ts
git commit -m "feat: context event subscriber registry and dispatcher"
```

---

### Task 8: Live-stack integration smoke

**Files:**
- Create: `server/test/integration/round-trip.test.ts`
- Modify: `server/package.json` (add `test:int` script)

**Interfaces:**
- Consumes: `loadConfig`, `anonClient`, `serviceClient`, `userScopedClient` (server/src/supabase.ts); `supabaseHubStore`, `ContextHub` (context module).
- Produces: `npm run test:int --workspace server` — a smoke proving a real round-trip under RLS.

- [ ] **Step 1: Add the integration test script**

In `server/package.json` `scripts`, add: `"test:int": "vitest run test/integration"`. (The default `"test": "vitest run"` includes `test/**`; to keep the live-stack test out of the default unit run, also change `"test"` to `"vitest run --exclude 'test/integration/**'"`.)

- [ ] **Step 2: Write the integration test**

`server/test/integration/round-trip.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { loadConfig } from '../../src/config.js'
import { anonClient, serviceClient, userScopedClient } from '../../src/supabase.js'
import { supabaseHubStore, supabaseEventStore } from '../../src/context/supabase-store.js'
import { ContextHub } from '../../src/context/index.js'

const config = loadConfig()
const email = `int-${Date.now()}@test.dev`
const password = 'Test-pass-123456'
let token: string
let workspaceId: string

beforeAll(async () => {
  const admin = serviceClient(config)
  await admin.auth.admin.createUser({ email, password, email_confirm: true })
  const { data, error } = await anonClient(config).auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`)
  token = data.session.access_token
  const db = userScopedClient(config, token)
  const { data: ws, error: wErr } = await db.rpc('create_workspace', { p_name: 'Int Co', p_slug: `int-${Date.now()}` })
  if (wErr) throw new Error(`create_workspace failed: ${wErr.message}`)
  workspaceId = (ws as { id: string }).id
})

describe('Context Hub round-trip (live stack)', () => {
  it('upsert writes a row under RLS, the trigger versions it and emits an outbox event', async () => {
    const db = userScopedClient(config, token)
    const store = supabaseHubStore(db)
    const rule = await ContextHub.rules.upsert(store, {
      workspace_id: workspaceId, rule_type: 'must_do', area: 'finance', statement: 'sign off invoices', applies_to: ['manager'],
    })
    expect(rule.version).toBe(1)
    expect(rule.created_by).toBeTruthy()

    const versions = await db.from('entity_versions').select('*').eq('entity_id', rule.id)
    expect(versions.data?.length).toBe(1)

    const events = await supabaseEventStore(db).pending()
    expect(events.some((e) => e.entity_id === rule.id && e.type === 'business_rules.insert')).toBe(true)
  })
})
```

- [ ] **Step 3: Run against the live stack**

Run (stack already up, `.env` populated from `supabase start`): `npm run test:int --workspace server`
Expected: PASS — round-trip test confirms `version=1`, one `entity_versions` row, and a `business_rules.insert` outbox event.

- [ ] **Step 4: Confirm the default unit run still excludes integration**

Run: `npm run test:server`
Expected: PASS — unit suite runs without the integration test (no live-stack dependency).

- [ ] **Step 5: Commit**

```bash
git add server/test/integration/round-trip.test.ts server/package.json
git commit -m "test: live-stack Context Hub round-trip integration smoke"
```

---

## Self-Review

**1. Spec coverage:**
- §3 entities → Task 1 (all 8 tables + base cols + RLS + business_profile partial unique). ✓
- §4 versioning/audit/trigger + entity_versions → Tasks 2 (table) + 3 (triggers). ✓
- §5 Context API (generic core + typed wrappers + facade) → Tasks 5, 6. ✓
- §6 links + outbox + dispatcher → Tasks 2 (tables), 6 (links + stores), 7 (registry/dispatcher). ✓
- §7 conflict detection → Task 4 (SQL) + Task 6 (`ruleConflicts` wrapper, exposed as `ContextHub.rules.conflicts`). ✓
- §9 seam fix → Task 0. ✓
- §11 testing: pgTAP isolation (Tasks 1–2), trigger (Task 3), conflicts (Task 4); Vitest repo/facade/dispatcher (Tasks 5–7); integration smoke (Task 8). ✓
- §10 file structure → matches tasks. ✓

**2. Placeholder scan:** No TBD/“add error handling”/“similar to Task N”. Every step has concrete code/SQL. The Task 6↔7 ordering note is an explicit dependency callout (not a placeholder); the recommended fix is stated (do Task 7's `events.ts` before Task 6's `index.ts`).

**3. Type consistency:** `HubStore`/`HubRow`/`EntityStatus` (Task 5) used unchanged in Tasks 6–8; `hubRepository` shape (`list/get/upsert/approve/deprecate`) consistent; `EventStore`/`ContextEvent`/`createRegistry`/`dispatchPendingEvents` (Task 7) consumed by Task 6 `supabase-store.ts` and Task 8; `ruleConflicts(db, ws)` and `RuleConflict.kind` match the SQL function's `kind` values; trigger event `type` format `<table>.<op>` matches the versioning test and the integration smoke (`business_rules.insert`).

**Note on task ordering:** Task 7 (`events.ts`) should be implemented before Task 6's `index.ts` event re-exports and `supabase-store.ts`'s `EventStore` import. Either run Task 7 first, or fold `events.ts` into Task 6's Step 3. The numbering keeps DB tasks (0–4) before TS tasks (5–8).
