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
