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
