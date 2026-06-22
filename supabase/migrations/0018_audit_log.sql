-- 0018_audit_log.sql
-- SH-3: Append-only, immutable audit_log table with admin-only RLS reads.
-- actor is a plain uuid with NO FK so deleting a user never mutates an audit row.
-- Immutability enforced by revoking UPDATE/DELETE from all app roles (incl. service_role).

create table public.audit_log (
  id           bigint generated always as identity primary key,
  workspace_id uuid,                        -- nullable; some events lack a workspace; no FK cascade
  actor        uuid,                         -- acting user; plain uuid, NO FK (user deletion must not mutate audit rows)
  actor_email  text,                         -- best-effort snapshot for app-level events (nullable)
  action       text not null,               -- 'insert'|'update'|'delete'|'authz.denied'|'auth.denied'|...
  entity_type  text,                         -- table name (data change) or event domain
  entity_id    uuid,                         -- affected row id (nullable)
  before       jsonb,                        -- OLD row (update/delete) / null
  after        jsonb,                        -- NEW row (insert/update) / null
  metadata     jsonb,                        -- app-level context: ip, request_id, route, method (nullable)
  at           timestamptz not null default now()
);

-- Indexes for common query patterns
create index audit_log_workspace_at_idx  on public.audit_log (workspace_id, at desc);
create index audit_log_entity_idx        on public.audit_log (entity_type, entity_id);
create index audit_log_actor_idx         on public.audit_log (actor);

-- RLS: enabled; admins read only their own tenant's rows
alter table public.audit_log enable row level security;

create policy audit_select_admin on public.audit_log
  for select
  using (public.is_workspace_admin(workspace_id));

-- NOTE (v1 limitation): rows with workspace_id IS NULL (e.g. auth.denied events with no
-- workspace) are invisible via this policy (is_workspace_admin(NULL) is false). Reading
-- cross-workspace/system security events requires a future service-role/superadmin path.

-- Grants: authenticated gets SELECT (RLS-gated); service_role gets INSERT only
grant select on public.audit_log to authenticated;
grant insert on public.audit_log to service_role;

-- Identity sequence access for service_role emitter
grant usage, select on sequence public.audit_log_id_seq to service_role;

-- Append-only: authenticated may only SELECT (RLS-gated); service_role may only INSERT/SELECT.
-- (Supabase default privileges grant authenticated all table privs on owner-created tables,
--  so we must explicitly revoke insert/update/delete/truncate.)
revoke insert, update, delete, truncate on public.audit_log from authenticated;
revoke update, delete, truncate on public.audit_log from service_role;
