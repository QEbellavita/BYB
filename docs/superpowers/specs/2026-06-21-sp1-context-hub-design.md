# SP-1: Context Hub — Design Spec

- **Date:** 2026-06-21
- **Status:** Approved (brainstorming) — pending written-spec review
- **Depends on:** SP-0 (Foundation & platform spine), merged to `main` (multi-tenant Supabase
  spine, RLS, auth/RBAC/workspace middleware, `userScopedClient`, module loader, CI).
- **Parent architecture:** `docs/superpowers/specs/2026-06-21-byb-platform-architecture-design.md` (§4, §10)

## 1. Goal

Build the **Context Hub** — BYB's single source of truth. A workspace defines how it operates
once here; every later feature module reads from and adapts to it. SP-1 delivers the Hub **engine**
plus **all 8 entities**, so SP-2 (onboarding) can write directly to it.

The Hub's integrity guarantees — every write is **versioned, audited, and emits an event**, and
nothing is silently overwritten or deleted — are **enforced in the database**, so they cannot be
bypassed by any caller (app, raw SQL, or a future AI agent).

## 2. Scope (decided in brainstorming)

- **In:** the 8 entities; DB-enforced versioning/audit; the generic Context API; cross-entity links;
  the transactional event **outbox** + in-process **dispatch** + subscriber registry; **deterministic
  conflict detection** (advisory); and the SP-0 **middleware-seam fix** (Task 0).
- **Deferred (no SP-1 consumer):** the Postgres `NOTIFY` → Supabase Realtime bridge (→ first live
  dashboard, ≈SP-2+); the action-executing **automation runner** (condition→action, ported from
  belcrm `trigger-engine`) (→ first feature with automations, ≈SP-3/SP-6); process-step↔rule conflict
  detection (→ SP-4 IPL); semantic/LLM conflict reasoning (later).

## 3. Data layer (decided: generic core + per-entity typed tables)

### 3.1 Common versioned/audited base
Every entity table is workspace-scoped with RLS and carries:
`id uuid pk, workspace_id uuid not null → workspaces, version int not null, status entity_status
not null default 'draft', created_by uuid, created_at timestamptz, updated_by uuid, updated_at
timestamptz, approved_by uuid, approved_at timestamptz, supersedes uuid`.
`entity_status` enum = `('draft','active','archived')`.

### 3.2 The 8 entities (entity-specific columns)
| Table | Columns |
|---|---|
| `business_profile` | `name`, `anzsic_code`, `anzsic_label`, `size`, `jurisdiction ('AU'|'NZ')`, `description`. One **active** row per workspace (partial unique index on `workspace_id where status='active'`). |
| `business_rules` | `rule_type ('business_rule'|'value_setting'|'must_do')`, `area`, `statement`, `operator`, `value jsonb`, `consequence`, `applies_to jsonb` (role/person/team identifiers) |
| `compliance_obligations` | `name`, `description`, `source ('australian_law'|'state_regulation'|'custom')`, `reference`, `anzsic_code`, `subscribe_updates bool` |
| `internal_processes` | `title`, `area`, `role`, `frequency`, `steps jsonb` (ordered), `faqs jsonb` |
| `decision_logic` | `name`, `description`, `logic jsonb` |
| `risk_frameworks` | `name`, `categories jsonb`, `appetite jsonb`, `matrix_config jsonb` |
| `governance` | `name`, `kind ('committee'|'authority'|'escalation_path')`, `members jsonb`, `details jsonb` |
| `org_people` | `person_name`, `title`, `email`, `responsibilities jsonb`, `member_user_id uuid → auth.users (nullable)`, `access_scope jsonb` |

Typed columns where we query/constrain (`rule_type`, `area`, `source`, `jurisdiction`, `kind`);
`jsonb` where the shape is open-ended (`applies_to`, `steps`, `logic`, `members`, …).

**`org_people` vs `workspace_members`:** `org_people` is the business's people & responsibilities
directory (may include people who aren't platform users); `workspace_members` (SP-0) is platform
access/RBAC. They link via `member_user_id`/`email`.

### 3.3 RLS
Every entity table (and `entity_versions`, `context_events`, `context_links`) has RLS enabled with
the membership-scoped policy `using/with check (public.is_workspace_member(workspace_id))`, identical
to the SP-0 pattern.

## 4. Versioning, audit & events (DB-enforced)

### 4.1 `entity_versions` (shared history)
`id, workspace_id, entity_type text, entity_id uuid, version int, snapshot jsonb, status, actor uuid,
created_at`. RLS membership-scoped.

### 4.2 `hub_version_and_emit()` trigger (attached to all 8 entity tables)
- **BEFORE insert/update:** set `version` (1 on insert, `OLD.version + 1` on update), `updated_at = now()`,
  and `created_by`/`updated_by` from `auth.uid()` (`created_by` only on insert).
- **AFTER insert/update:** insert `to_jsonb(NEW)` into `entity_versions`; insert a row into
  `context_events` (the outbox) with `type = TG_TABLE_NAME || '.' || (TG_OP lowercased)`,
  `before = to_jsonb(OLD)` (null on insert), `after = to_jsonb(NEW)`, `actor = auth.uid()`.
- **Deprecate, never delete:** the Context API never issues `DELETE` on entity tables; removal is an
  update to `status='archived'` (still versioned + audited). (`context_links` may be hard-deleted —
  it is metadata, not source-of-truth.)

This makes "every write is versioned + audited + emits an event" a database invariant.

## 5. The Context API (TypeScript, app-facing)

A generic core `hubRepository(entityType, table)` + a thin typed wrapper per entity, all RLS-scoped
via `userScopedClient(config, accessToken)`:
```
ContextHub.rules.list(db, { area, appliesTo })  → Rule[]
ContextHub.rules.get(db, id)                     → Rule | null
ContextHub.rules.upsert(db, input)               → Rule     (DB trigger versions+audits+emits)
ContextHub.rules.approve(db, id)                  → Rule     (status→active, approved_by/at)
ContextHub.rules.deprecate(db, id)                → Rule     (status→archived)
```
Same shape for `profile`, `obligations`, `processes`, `decisionLogic`, `riskFrameworks`,
`governance`, `people`. Links: `ContextHub.links.connect/list/disconnect`. Conflicts:
`ContextHub.rules.conflicts(db)` (§7). The app never passes `actor`/`version` — the DB captures them.
Reads return typed domain objects.

## 6. Cross-entity links & the event outbox

### 6.1 `context_links`
`id, workspace_id, from_type, from_id, to_type, to_id, relation (nullable), created_by, created_at`.
RLS-scoped; unique on `(workspace_id, from_type, from_id, to_type, to_id, relation)`. `connect`,
`list`, `disconnect` (real delete — metadata, not versioned).

### 6.2 `context_events` (outbox) + dispatch
`id, workspace_id, type, entity_type, entity_id, before jsonb, after jsonb, actor, created_at,
dispatched_at (nullable)`. Written by the §4.2 trigger in the same transaction as the entity change
(no event for a rolled-back write).
- **Subscriber registry:** `onContextEvent(typeOrPrefix, handler)` — prefix matching (e.g.
  `'business_rules.'` or `'business_rules.update'`).
- **Dispatcher:** `dispatchPendingEvents(db, registry)` — reads undispatched events oldest-first,
  invokes matching handlers, stamps `dispatched_at`. **At-least-once** (handlers must be idempotent);
  a thrown handler leaves the event undispatched for retry.
- SP-1 ships the registry + dispatcher + a tested sample subscriber. Wiring the dispatcher to a
  leased interval (Quantara `job-lease`) is enabled when the first real subscriber lands.

## 7. Conflict detection (deterministic, advisory)

Postgres function `context_rule_conflicts(ws uuid)` + TS wrapper `ContextHub.rules.conflicts(db)`,
returning `{ ruleA, ruleB, kind: 'duplicate' | 'divergent' }[]`. Over **`active`** `business_rules`
in the workspace, comparing each unordered pair (`ruleA.id < ruleB.id`) that satisfies all three:
- **same `area`** — `a.area = b.area` (exact);
- **overlapping `applies_to`** — `applies_to` is a JSON **array of string identifiers**
  (role/person/team); overlap = the two arrays share at least one element
  (`exists (select 1 from jsonb_array_elements_text(a.applies_to) x join
  jsonb_array_elements_text(b.applies_to) y on x = y)`);
- **same normalized `statement`** — `lower(btrim(a.statement)) = lower(btrim(b.statement))`.

Then classify:
- `duplicate` — `a.value = b.value` AND `a.consequence = b.consequence` (redundant rule).
- `divergent` — otherwise (different `value` or `consequence`) (contradictory — the dangerous case).

Advisory only: returns flags; **never blocks a write**. Narrow by design (pure set/equality logic,
no semantic guessing, zero false-positive risk). Process↔rule and semantic conflicts are deferred (§2).

## 8. Rules-engine boundary

SP-1 delivers the rule **data model** (`business_rules`) + conflict detection. The
**action-executing automation runner** (condition→action, cooldown, audited side-effects) is deferred
to the first feature that needs automations; the SP-1 event outbox is the substrate it will consume.

## 9. Task 0 — middleware-seam fix (from the SP-0 final review)

Add `server/src/middleware/authed-workspace.ts` exporting `authedWorkspaceRoute(config)` =
`[requireAuth(...), requireWorkspace(...)]` so routes compose them in the right order, **and** a
fail-loud guard in `requireWorkspace`: if `req.user`/`req.accessToken` is unset, respond `500`
(a programming/ordering error) — distinct from the existing fail-closed `403` for a genuine
non-member. Covered by tests. Done before any Hub wiring.

## 10. File structure

```
supabase/migrations/
  0007_context_hub_entities.sql      # entity_status enum, 8 entity tables, base cols, indexes, RLS
  0008_context_hub_versioning.sql    # entity_versions + hub_version_and_emit() trigger on all 8
  0009_context_hub_events_links.sql  # context_events (outbox) + context_links + RLS
  0010_context_rule_conflicts.sql    # context_rule_conflicts(ws) function
supabase/tests/
  context_hub_isolation_test.sql     # cross-tenant isolation across all 11 new Hub tables
  context_hub_versioning_test.sql    # trigger: version bump + snapshot + outbox row
  context_rule_conflicts_test.sql    # duplicate / divergent / no-conflict
server/src/context/
  hub-repository.ts   # generic CRUD core (RLS-scoped via userScopedClient)
  entities.ts         # typed per-entity wrappers + domain types
  links.ts            # connect/list/disconnect
  events.ts           # subscriber registry + dispatchPendingEvents()
  conflicts.ts        # conflicts() wrapper over the SQL function
  index.ts            # ContextHub facade
server/src/middleware/authed-workspace.ts   # Task 0 composed helper
server/test/context/*.test.ts
```

## 11. Testing strategy

- **pgTAP (DB-level, where the heavy logic lives):**
  - **RLS isolation across all 11 new tenant tables** (8 entities + `entity_versions` +
    `context_events` + `context_links`) — one consolidated test (honors the Global Constraint).
  - **Trigger:** every insert/update bumps `version`, writes an `entity_versions` snapshot, and
    enqueues a `context_events` row; archived = update (still versioned).
  - **Conflict function:** duplicate / divergent / clean cases.
- **Vitest (TS, injected ports, no DB):** dispatcher (drain order, at-least-once, idempotency,
  retry-on-throw, `dispatched_at` stamping), subscriber registry (prefix match), domain mapping,
  and the Task-0 seam middleware (composed helper + fail-loud guard).
- **Integration smoke:** one real round-trip — `ContextHub.rules.upsert` under RLS → row written →
  trigger produced a version + an outbox event.

Every new tenant table ships with its isolation assertion before merge (the CI gate).

## 12. Global constraints (inherited)
Native Postgres + RLS on every tenant table + passing pgTAP isolation test; dedicated Supabase ports
54331-3; TypeScript strict + ESM (`.js` imports); SECURITY DEFINER funcs set `search_path = public`;
RLS-sensitive server queries use `userScopedClient`; conventional commits; feature work on a branch
(`sp-1-context-hub`), not committed straight to `main`.

## 13. Non-goals
Realtime bridge; automation action-runner; process↔rule and semantic conflict detection; any feature
module UI (entities are written by SP-2+); the ANZSIC obligations dataset (SP-7 — `compliance_obligations`
here is the table, not the curated data).
