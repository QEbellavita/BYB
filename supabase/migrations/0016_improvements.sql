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
