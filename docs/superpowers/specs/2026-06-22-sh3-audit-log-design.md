# SH-3 — Immutable audit log + created_by FKs (design spec)

**Date:** 2026-06-22 · **Status:** approved (brainstorm) → ready for plan
**Sub-project:** Security Hardening track, phase SH-3 (after SH-2/SH-2.1 + SH-1).

## Goal

A comprehensive, append-only, tamper-resistant **audit log** of data changes + admin/security events across the platform, plus real **`created_by`/`updated_by` FKs** to `auth.users`. Satisfies the security standard's "Audit: comprehensive, append-only/immutable audit log of changes + auth/admin events (not just entity versioning)."

## Decisions (locked during brainstorm 2026-06-22)

1. **Hybrid mechanism:** DB triggers are the immutable backbone for all tenant-table data changes (cannot be bypassed by an app bug; capture `auth.uid()` as the actor — the *real* user now that SH-2.1 user-scoped the writes). App-level emission covers security events that are not DB writes (authorization/authentication failures).
2. **Scope:** data changes + admin/security events + authz/auth failures. Admin events (role change, invite, workspace creation, onboarding completion, feature toggle) are captured *for free* by the data-change triggers because they are themselves table writes. **Read-access logging is OUT of scope** for v1 (volume/perf).
3. **Immutability:** append-only — `REVOKE UPDATE, DELETE` from all app roles (incl. `service_role`); RLS so workspace admins read only their own tenant's rows. **No hash-chain** in v1 (a DB-owner/superuser compromise is out of the v1 threat model; tracked as a follow-up).
4. **Audit read API:** a minimal admin **read endpoint** is in scope; the **web UI is deferred**.
5. **Honesty boundary:** actual login/logout/failed-login happen SPA→Supabase Auth, not through our API — those live in Supabase's own `auth.audit_log_entries`. Our `audit_log` captures everything that flows through our API and DB. Documented, not faked.

## Current state (grounding)

- 8 Context Hub entity tables have `created_by`/`updated_by`/`approved_by` (bare `uuid`, **no FK**) AND change auditing via `hub_before_write`/`hub_after_write` triggers (→ `entity_versions` + `context_events`, actor = `auth.uid()`).
- `risk_entries`, `complaints`, `improvements` have `created_by`/`updated_by` (bare `uuid`) but **no** change-audit triggers.
- `workspace_invites.invited_by`, `onboarding_sessions.started_by/completed_by` are already FKs to `auth.users`.
- No unified immutable audit log; `context_events` is Hub-specific.
- Latest migration: `0017`. SH-3 migrations are `0018`+.

## Components

### 1. `audit_log` table — migration `0018_audit_log.sql`
```
id           bigint generated always as identity primary key   -- monotonic ordering
workspace_id uuid                                              -- nullable (some events lack a workspace); no cascade
actor        uuid                                              -- acting user; PLAIN uuid, NO FK (deleting a user must never mutate an audit row)
actor_email  text                                              -- best-effort snapshot for app-level events (nullable)
action       text not null                                    -- 'insert'|'update'|'delete' | 'authz.denied'|'auth.denied'|...
entity_type  text                                              -- table name (data change) or event domain
entity_id    uuid                                             -- affected row id (nullable)
before       jsonb                                            -- OLD row (update/delete) / null
after        jsonb                                            -- NEW row (insert/update) / null
metadata     jsonb                                            -- app-level context: ip, request_id, route, method (nullable)
at           timestamptz not null default now()
```
Indexes: `(workspace_id, at desc)`, `(entity_type, entity_id)`, `(actor)`.
**Immutability + RLS:**
- `alter table audit_log enable row level security;`
- SELECT policy `audit_select_admin`: `using (public.is_workspace_admin(workspace_id))` — admins read only their tenant's rows.
- No INSERT/UPDATE/DELETE policy for `authenticated` (the SECURITY-DEFINER trigger writes as owner; the app emitter writes via `service_role`).
- Grants: `grant select on audit_log to authenticated;` (RLS-gated). `grant insert on audit_log to service_role;`. `revoke update, delete on audit_log from authenticated, service_role;`. (`authenticated` never gets insert/update/delete.)
- `grant usage, select on sequence audit_log_id_seq to service_role;` (identity needs sequence access for the service-role emitter).

### 2. Generalized data-change trigger — migration `0019_audit_triggers.sql`
```sql
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare ws uuid; eid uuid;
begin
  ws  := coalesce((case when TG_OP='DELETE' then OLD else NEW end)).workspace_id;
  eid := coalesce((case when TG_OP='DELETE' then OLD else NEW end)).id;
  insert into audit_log(workspace_id, actor, action, entity_type, entity_id, before, after)
  values (ws, auth.uid(), lower(TG_OP), TG_TABLE_NAME, eid,
          case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) else null end,
          case when TG_OP in ('INSERT','UPDATE') then to_jsonb(NEW) else null end);
  return null; -- AFTER trigger
end $$;
```
(Implementer: the `(case ... end).workspace_id` field access on a record needs the documented PL/pgSQL form — use the version that compiles; e.g. assign `rec := case when TG_OP='DELETE' then OLD else NEW end` into a `record`/rowtype then read `rec.workspace_id`/`rec.id`. Verify against live psql.)
Attach `AFTER INSERT OR UPDATE OR DELETE` (via a `do $$ ... foreach $$` loop, like 0009) to the **18 tenant tables**: the 8 Hub entities, `risk_entries`, `complaints`, `improvements`, `workspaces`, `workspace_members`, `workspace_invites`, `workspace_features`, `onboarding_sessions`, `onboarding_invite_drafts`, `context_links`.
**Excluded** (avoid auditing the audit/derived infra): `entity_versions`, `context_events`, `audit_log` itself.
Note: this is additive to the Hub's existing `entity_versions`/`context_events` (versioning + functional outbox) — `audit_log` is the unified security-of-record. Documented overlap, intentional.

### 3. `created_by`/`updated_by` FK retrofit — migration `0020_created_by_fks.sql`
For the 11 tables with bare actor columns (8 Hub entities + `risk_entries` + `complaints` + `improvements`):
- First null orphans so the constraint validates on existing data:
  `update <t> set created_by = null where created_by is not null and created_by not in (select id from auth.users);` (same for `updated_by`, and `approved_by` on Hub entities).
- Then `alter table <t> add constraint <t>_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;` (same for `updated_by`; `approved_by` on Hub entities).
`on delete set null` preserves rows when a user is removed. (Done via a `do $$` loop per table for the shared columns; Hub entities also get `approved_by`.)

### 4. App-level audit service — `server/src/services/audit.ts` + middleware wiring
- `createAuditService(serviceDb): { record(e): Promise<void> }` inserting one `audit_log` row via the **service-role** client (insert-only grant). `record` swallows/logs its own errors so an audit failure never breaks the request (but logs server-side).
- Wire into the failure paths of `requireAuth` (401 → `action:'auth.denied'`, metadata: ip/route/method, no actor) and `requireWorkspaceAdmin` (403 → `action:'authz.denied'`, actor = `req.user.id`, `workspace_id = req.workspaceId`, metadata). Inject the recorder as an optional dep so the middlewares stay unit-testable without a DB.
- Request context (ip/request-id) read from the request in the middleware (Express `req.ip` — correct now that SH-1 set `trust proxy`; `req.headers['x-request-id']` if present).

### 5. Admin read endpoint — `GET /api/audit`
- `requireAuth` + `requireWorkspace` + `requireWorkspaceAdmin`; queries `audit_log` via a **per-request `userScopedClient`** so RLS enforces admin-only, tenant-scoped reads (defense-in-depth, consistent with SH-2.1).
- Pagination: `?limit` (default 50, max 200) + `?before` (id cursor, descending by `id`). Returns `{ entries, nextCursor }`.
- Mounted as a top-level route (cross-module), admin-gated. **No web UI** (deferred).

## Testing (TDD)
- **pgTAP** (`supabase/tests/`):
  - `audit_log_immutability_test.sql`: under `service_role` and `authenticated`, `UPDATE`/`DELETE` on `audit_log` → `42501`; `INSERT` allowed for `service_role` only.
  - `audit_log_rls_test.sql`: admin reads own-tenant rows; non-admin member sees 0; cross-tenant admin sees 0 (positive control: admin sees ≥1 own).
  - `audit_triggers_test.sql`: an INSERT/UPDATE/DELETE as an authenticated user on a sample tenant table writes an `audit_log` row with correct `actor` (= jwt sub), `action`, `entity_type`, `entity_id`, `before`/`after`; a representative subset of the 18 tables (at least one Hub, one SP-3, one workspace-core, one onboarding) + assert trigger exists on all 18.
  - `created_by_fks_test.sql`: the FK constraints exist on the 11 tables; deleting a referenced user sets `created_by` null (not blocked).
- **server unit:** `audit.ts` service records a row (mocked db); `requireWorkspaceAdmin`/`requireAuth` call the recorder on failure with the right shape; the read endpoint paginates + admin-gates.
- **integration (live):** a real authenticated user action through the API produces an `audit_log` row with that user as actor; `GET /api/audit` returns the tenant's rows for an admin and 403 for a non-admin.
- Regression: full suite stays green (SH-1 baseline: 222 server + 78 web + 16 integration).

## Base branch / sequencing
Stacked on PR #11 (`sh-1-transport-hardening`), which is stacked on PR #9. Migrations are `0018`–`0020`. PR targets `sh-1-transport-hardening`; GitHub retargets up the chain as each merges. Merge order: #9 → #11 → this. The stack is deep — merging the chain soon is advisable.

## Out-of-scope follow-ups
- Hash-chain / cryptographic tamper-evidence on `audit_log`.
- Read-access ("who read what") auditing.
- Request-context enrichment of DB-trigger rows (via PostgREST `request.headers` GUC) — would add IP/request-id to trigger-sourced rows, not just app-level ones.
- Audit-log web UI for admins.
- Retention/archival policy for `audit_log`.
