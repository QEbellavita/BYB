# SH-3 Audit Log + created_by FKs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A comprehensive, append-only, immutable audit log of data changes + admin/security events, plus real `created_by`/`updated_by` FKs to `auth.users`. (Spec: `docs/superpowers/specs/2026-06-22-sh3-audit-log-design.md` — read it for full DDL/rationale; it is authoritative.)

**Architecture:** DB-trigger backbone (a SECURITY-DEFINER trigger on every tenant table writes to an append-only `audit_log`, actor = `auth.uid()`) + an app-level audit service for authz/auth failures + an admin read endpoint. Append-only via REVOKE + RLS.

**Tech Stack:** Postgres + pgTAP, Node 22+/Express/TS-ESM, Vitest + Supertest.

## Global Constraints

- **Bank-grade** (memory `byb-security-standard`): append-only/immutable audit; RLS-scoped reads; least privilege.
- **Immutability:** `audit_log` gets NO update/delete grant to `authenticated` or `service_role`; SELECT is RLS-gated to workspace admins; INSERT only via the SECURITY-DEFINER trigger (as owner) and the `service_role` emitter. (`service_role` has BYPASSRLS but NOT table-privilege bypass, so REVOKE UPDATE/DELETE is effective.)
- **Actor:** `audit_log.actor` is a PLAIN uuid (NO FK) so deleting a user never mutates an audit row.
- **ESM** `.js` import specifiers. Migrations are forward-only, `0018`–`0020`.
- **pgTAP runner:** `supabase test db` CLI is broken locally → apply migrations and run tests via `psql postgresql://postgres:postgres@127.0.0.1:54332/postgres -f <file>`; success = all `ok`, no `not ok`, correct plan count. (Local DB is at migration 0017; apply 0018–0020 via psql.) CI runs `supabase test db` for real.
- **18 audited tenant tables:** `business_profile, business_rules, compliance_obligations, internal_processes, decision_logic, risk_frameworks, governance, org_people, risk_entries, complaints, improvements, workspaces, workspace_members, workspace_invites, workspace_features, onboarding_sessions, onboarding_invite_drafts, context_links`. **Excluded:** `entity_versions, context_events, audit_log`.
- **11 FK-retrofit tables:** the 8 Hub entities + `risk_entries, complaints, improvements`.
- Baseline must stay green: **222 server + 78 web + 16 integration**. Commit after each task; do NOT push.

---

### Task 1: `audit_log` table — append-only + RLS

**Files:** Create `supabase/migrations/0018_audit_log.sql`; Create `supabase/tests/audit_log_immutability_test.sql`, `supabase/tests/audit_log_rls_test.sql`.

- [ ] **Step 1: Write the pgTAP tests first (RED).**
  - `audit_log_immutability_test.sql` (`plan(3)`): as `service_role`, `INSERT` into audit_log `lives_ok`; `UPDATE audit_log set action='x'` → `throws_ok '42501'`; `DELETE from audit_log` → `throws_ok '42501'`. (Set role with `set local role service_role;`.)
  - `audit_log_rls_test.sql` (`plan(3)`): seed 2 workspaces+owners (superuser) and 1 audit_log row in WS-A; `set local role authenticated` + WS-A admin claims → admin sees its own row (count 1, positive control); WS-A member-but-not-admin → 0; WS-B admin → 0. (Use the existing isolation tests' fixture pattern; `is_workspace_admin` is defined in 0011.)
- [ ] **Step 2: Run via psql → RED** (table/policies don't exist yet).
  `psql postgresql://postgres:postgres@127.0.0.1:54332/postgres -f supabase/tests/audit_log_immutability_test.sql` (errors: relation audit_log does not exist).
- [ ] **Step 3: Write `0018_audit_log.sql`** using the schema in spec §1 (id identity PK; workspace_id; actor uuid NO FK; actor_email text; action not null; entity_type; entity_id; before/after/metadata jsonb; at). Add the 3 indexes. Then:
```sql
alter table public.audit_log enable row level security;
create policy audit_select_admin on public.audit_log for select using (public.is_workspace_admin(workspace_id));
grant select on public.audit_log to authenticated;          -- RLS-gated
grant insert on public.audit_log to service_role;
grant usage, select on sequence public.audit_log_id_seq to service_role;
revoke update, delete on public.audit_log from authenticated, service_role;
```
- [ ] **Step 4: Apply migration via psql** (`-f supabase/migrations/0018_audit_log.sql`).
- [ ] **Step 5: Run both pgTAP files → GREEN** (all `ok`, plan counts match). If the immutability test shows `service_role` CAN update/delete, the REVOKE is wrong — fix before proceeding (do not weaken the test).
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(audit): append-only audit_log table + admin RLS (SH-3)"`

---

### Task 2: Generalized data-change audit trigger

**Files:** Create `supabase/migrations/0019_audit_triggers.sql`; Create `supabase/tests/audit_triggers_test.sql`.

- [ ] **Step 1: Write `audit_triggers_test.sql` (RED).** `plan` ~ 8. As an authenticated user (WS owner, `set local role authenticated` + claims), perform INSERT/UPDATE/DELETE on a representative subset — at least `risk_entries` (SP-3), `business_profile` (Hub), `workspace_members` (core), `onboarding_sessions` (onboarding) — and assert an `audit_log` row appears with: correct `actor` (= jwt sub), `action` (insert/update/delete), `entity_type` (table name), `entity_id`, and `before`/`after` populated correctly (insert: after only; update: both; delete: before only). Also assert (catalog query) that an `audit_row_change` trigger EXISTS on all 18 tables and on NONE of the 3 excluded tables.
- [ ] **Step 2: Run → RED** (no triggers; no audit rows from changes).
- [ ] **Step 3: Write `0019_audit_triggers.sql`** — the `public.audit_row_change()` SECURITY-DEFINER function from spec §2. IMPORTANT: verify the PL/pgSQL record field-access compiles — assign the chosen row to a `record`/rowtype variable and read `.workspace_id`/`.id` from it; test against live psql before finalizing. Then a `do $$ ... foreach t in array array[<the 18 tables>] ... execute format('create trigger %1$s_audit after insert or update or delete on %1$s for each row execute function public.audit_row_change()', t) ... $$;`.
- [ ] **Step 4: Apply via psql** (`-f .../0019_audit_triggers.sql`).
- [ ] **Step 5: Run `audit_triggers_test.sql` → GREEN.** Then re-run the FULL pgTAP suite (every `supabase/tests/*.sql`) — confirm the new triggers didn't break existing isolation tests (e.g., a seed INSERT now also writes audit_log; tests use begin/rollback so it's isolated, but verify no `not ok`).
- [ ] **Step 6: Run `npm run test:int --workspace server`** — the live integration flows now also write audit rows; confirm 16/16 still pass (the extra inserts must not break existing flows).
- [ ] **Step 7: Commit.** `git add -A && git commit -m "feat(audit): data-change trigger on all tenant tables (SH-3)"`

---

### Task 3: created_by / updated_by / approved_by FK retrofit

**Files:** Create `supabase/migrations/0020_created_by_fks.sql`; Create `supabase/tests/created_by_fks_test.sql`.

- [ ] **Step 1: Write `created_by_fks_test.sql` (RED).** `plan` ~ (count of constraints checked). Query `information_schema`/`pg_constraint` to assert a FK from `<t>.created_by` → `auth.users(id)` exists for each of the 11 tables (and `updated_by`; `approved_by` for the 8 Hub entities). Add one behavioral assertion: insert a user + a row referencing it, delete the user, assert the row's `created_by` became NULL (ON DELETE SET NULL) rather than the delete being blocked.
- [ ] **Step 2: Run → RED** (constraints don't exist).
- [ ] **Step 3: Write `0020_created_by_fks.sql`.** For each of the 11 tables (use a `do $$` loop for `created_by`+`updated_by`; handle the 8 Hub entities' `approved_by` in the loop or a second loop):
  - null orphans first: `update <t> set created_by=null where created_by is not null and created_by not in (select id from auth.users);` (same for updated_by/approved_by).
  - then `alter table <t> add constraint <t>_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;` (same naming for updated_by/approved_by).
- [ ] **Step 4: Apply via psql; run the test → GREEN.** Re-run full pgTAP suite (no `not ok`).
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(audit): created_by/updated_by/approved_by FKs to auth.users (SH-3)"`

---

### Task 4: App-level audit service + authz/auth failure wiring

**Files:** Create `server/src/services/audit.ts`; Modify `server/src/middleware/require-auth.ts`, `server/src/middleware/require-workspace-admin.ts` (inject optional recorder); Modify `server/src/app.ts` (construct the service, pass the recorder into the two middlewares); Test: `server/test/audit-service.test.ts` (+ assertions in the middleware tests).

- [ ] **Step 1: Write failing tests.** `audit-service.test.ts`: `createAuditService(fakeDb).record({...})` inserts one row into `audit_log` with the given fields (assert the fake db received the insert); `record` does NOT throw if the db insert rejects (it logs + swallows). Middleware tests: a `requireWorkspaceAdmin` 403 calls the injected recorder with `action:'authz.denied'`, `actor=req.user.id`, `workspace_id=req.workspaceId`; a `requireAuth` 401 calls it with `action:'auth.denied'` (no actor). Use a spy recorder.
- [ ] **Step 2: Run → RED.**
- [ ] **Step 3: Implement `services/audit.ts`:**
```ts
import type { SupabaseClient } from '@supabase/supabase-js'
export interface AuditEvent {
  workspaceId?: string | null; actor?: string | null; actorEmail?: string | null
  action: string; entityType?: string | null; entityId?: string | null
  metadata?: Record<string, unknown> | null
}
export interface AuditRecorder { record(e: AuditEvent): Promise<void> }
export function createAuditService(db: SupabaseClient): AuditRecorder {
  return {
    async record(e) {
      try {
        const { error } = await db.from('audit_log').insert({
          workspace_id: e.workspaceId ?? null, actor: e.actor ?? null, actor_email: e.actorEmail ?? null,
          action: e.action, entity_type: e.entityType ?? null, entity_id: e.entityId ?? null,
          metadata: e.metadata ?? null,
        })
        if (error) console.error('[audit] insert failed:', error.message)
      } catch (err) { console.error('[audit] insert threw:', err) }
    },
  }
}
```
- [ ] **Step 4: Wire recorder into the two middlewares** as an OPTIONAL dep (e.g., `requireWorkspaceAdmin(opts?: { audit?: AuditRecorder })`) — on the denial path, call `opts?.audit?.record({...})` with ip/route/method from `req` (do not await-block the response if simpler to fire-and-forget; but awaiting is fine — record swallows errors). Keep the existing 401/403 behavior identical. Construct `createAuditService(service)` in `app.ts` and pass it in. Read the two middleware files first to match their signatures and avoid breaking existing callers/tests (keep the dep optional so existing unit tests pass).
- [ ] **Step 5: Run focused + full server suite → GREEN.** `npm run test --workspace server`.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(audit): app-level audit service + authz/auth failure logging (SH-3)"`

---

### Task 5: Admin audit read endpoint `GET /api/audit`

**Files:** Create `server/src/routes/audit.ts` (router); Modify `server/src/app.ts` (mount it); Test: `server/test/audit-route.test.ts` + integration in `server/test/integration/audit.test.ts`.

- [ ] **Step 1: Write failing tests.**
  - Unit (`audit-route.test.ts`, supertest + injected deps): admin gets 200 + `{ entries, nextCursor }`; non-admin gets 403; `?limit` clamped to ≤200; `?before=<id>` passed through to the store as a descending cursor. Use a fake store so no DB.
  - Integration (`integration/audit.test.ts`, live): create a tenant + admin, perform an action that writes an audit row, `GET /api/audit` with the admin returns ≥1 entry whose actor = the admin; a second-tenant user gets 403/empty for tenant-1's data.
- [ ] **Step 2: Run → RED.**
- [ ] **Step 3: Implement the router.** `GET /api/audit` behind `requireAuth` + `requireWorkspace` + `requireWorkspaceAdmin`. Build a per-request `userScopedClient(config, req.accessToken!)` (RLS enforces admin + tenant scope — defense-in-depth). Query: `audit_log` filtered by `workspace_id = req.workspaceId`, `order by id desc`, `limit = min(Number(req.query.limit ?? 50), 200)`, and if `req.query.before` is set, `.lt('id', before)`. Return `{ entries, nextCursor: entries.length ? entries[entries.length-1].id : null }`. (Match the existing module-route structure/error handling for consistency; read `server/src/routes/me.ts` for the route+config pattern.)
- [ ] **Step 4: Mount in `app.ts`** inside the `if (config)` block (it needs config for `userScopedClient`); place after `meRouter`. The general `apiRateLimiter` already covers it.
- [ ] **Step 5: Run focused + full server + integration → GREEN.** `npm test && npm run test:int --workspace server` (expect server 222+new, web 78, integration 16+new).
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(audit): admin audit-log read endpoint GET /api/audit (SH-3)"`

---

## Self-Review notes
- **Spec coverage:** audit_log table+RLS+immutability → T1; data-change triggers (18 tables) → T2; created_by FKs (11 tables) → T3; app audit service + failure wiring → T4; admin read endpoint → T5. UI deferred (per spec). Hash-chain/reads/request-enrichment out of scope (per spec).
- **Order:** T1 → T2 (trigger needs the table) → T3 (independent, after for clean migration order) → T4 (writes to the table) → T5 (reads the table). Sequential; each ends with a committed, tested deliverable.
- **Type consistency:** `AuditRecorder`/`AuditEvent` defined in T4 (`services/audit.ts`), consumed in T4 (middlewares) and available to T5 if needed. Migration numbers 0018→0020 monotonic.
