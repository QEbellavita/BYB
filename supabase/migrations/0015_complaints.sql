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
