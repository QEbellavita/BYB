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
