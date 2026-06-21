-- 0001_spine_schema.sql — BYB tenancy spine (ported/trimmed from Cinder)
create extension if not exists "pgcrypto";

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  created_at timestamptz not null default now()
);

create type member_role as enum
  ('owner','admin','manager','compliance_officer','accountant','staff');

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role member_role not null default 'staff',
  permissions jsonb not null default '{}'::jsonb,  -- { "granted": [...], "revoked": [...] }
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on workspace_members (user_id);
