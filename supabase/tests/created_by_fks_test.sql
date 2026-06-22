-- created_by_fks_test.sql
-- pgTAP tests asserting FK constraints from actor columns → auth.users(id)
-- on 11 tables: 8 Hub entities + risk_entries + complaints + improvements
-- Plan: 30 FK existence checks + 1 behavioral test = 31

\set ON_ERROR_STOP 1
begin;
select plan(31);

-- ────────────────────────────────────────────────────────────────────────────
-- Helper: assert a FK constraint exists from <table>.<col> → auth.users(id)
-- ────────────────────────────────────────────────────────────────────────────

-- created_by FKs — all 11 tables
select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'business_profile'
      and c.conname = 'business_profile_created_by_fkey'
  ),
  'business_profile.created_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'business_rules'
      and c.conname = 'business_rules_created_by_fkey'
  ),
  'business_rules.created_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'compliance_obligations'
      and c.conname = 'compliance_obligations_created_by_fkey'
  ),
  'compliance_obligations.created_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'internal_processes'
      and c.conname = 'internal_processes_created_by_fkey'
  ),
  'internal_processes.created_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'decision_logic'
      and c.conname = 'decision_logic_created_by_fkey'
  ),
  'decision_logic.created_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'risk_frameworks'
      and c.conname = 'risk_frameworks_created_by_fkey'
  ),
  'risk_frameworks.created_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'governance'
      and c.conname = 'governance_created_by_fkey'
  ),
  'governance.created_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'org_people'
      and c.conname = 'org_people_created_by_fkey'
  ),
  'org_people.created_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'risk_entries'
      and c.conname = 'risk_entries_created_by_fkey'
  ),
  'risk_entries.created_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'complaints'
      and c.conname = 'complaints_created_by_fkey'
  ),
  'complaints.created_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'improvements'
      and c.conname = 'improvements_created_by_fkey'
  ),
  'improvements.created_by has FK to auth.users'
);

-- ────────────────────────────────────────────────────────────────────────────
-- updated_by FKs — all 11 tables
-- ────────────────────────────────────────────────────────────────────────────

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'business_profile'
      and c.conname = 'business_profile_updated_by_fkey'
  ),
  'business_profile.updated_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'business_rules'
      and c.conname = 'business_rules_updated_by_fkey'
  ),
  'business_rules.updated_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'compliance_obligations'
      and c.conname = 'compliance_obligations_updated_by_fkey'
  ),
  'compliance_obligations.updated_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'internal_processes'
      and c.conname = 'internal_processes_updated_by_fkey'
  ),
  'internal_processes.updated_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'decision_logic'
      and c.conname = 'decision_logic_updated_by_fkey'
  ),
  'decision_logic.updated_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'risk_frameworks'
      and c.conname = 'risk_frameworks_updated_by_fkey'
  ),
  'risk_frameworks.updated_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'governance'
      and c.conname = 'governance_updated_by_fkey'
  ),
  'governance.updated_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'org_people'
      and c.conname = 'org_people_updated_by_fkey'
  ),
  'org_people.updated_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'risk_entries'
      and c.conname = 'risk_entries_updated_by_fkey'
  ),
  'risk_entries.updated_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'complaints'
      and c.conname = 'complaints_updated_by_fkey'
  ),
  'complaints.updated_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'improvements'
      and c.conname = 'improvements_updated_by_fkey'
  ),
  'improvements.updated_by has FK to auth.users'
);

-- ────────────────────────────────────────────────────────────────────────────
-- approved_by FKs — 8 Hub entities only
-- ────────────────────────────────────────────────────────────────────────────

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'business_profile'
      and c.conname = 'business_profile_approved_by_fkey'
  ),
  'business_profile.approved_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'business_rules'
      and c.conname = 'business_rules_approved_by_fkey'
  ),
  'business_rules.approved_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'compliance_obligations'
      and c.conname = 'compliance_obligations_approved_by_fkey'
  ),
  'compliance_obligations.approved_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'internal_processes'
      and c.conname = 'internal_processes_approved_by_fkey'
  ),
  'internal_processes.approved_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'decision_logic'
      and c.conname = 'decision_logic_approved_by_fkey'
  ),
  'decision_logic.approved_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'risk_frameworks'
      and c.conname = 'risk_frameworks_approved_by_fkey'
  ),
  'risk_frameworks.approved_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'governance'
      and c.conname = 'governance_approved_by_fkey'
  ),
  'governance.approved_by has FK to auth.users'
);

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'org_people'
      and c.conname = 'org_people_approved_by_fkey'
  ),
  'org_people.approved_by has FK to auth.users'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Behavioral test: ON DELETE SET NULL
-- Insert a user, create a business_profile row referencing it as created_by,
-- delete the user, assert created_by became NULL (not blocked).
-- Wrapped in BEGIN/ROLLBACK so it leaves no state.
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_user_id  uuid := gen_random_uuid();
  v_ws_id    uuid;
  v_row_id   uuid;
  v_created  uuid;
begin
  -- need a workspace for FK on business_profile
  insert into workspaces(id, name, slug)
    values (gen_random_uuid(), 'test-ws-fk', 'test-ws-fk-' || extract(epoch from now())::bigint)
    returning id into v_ws_id;

  -- insert a real auth user
  insert into auth.users(id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values (v_user_id, v_user_id || '@test.invalid', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

  -- insert a business_profile row with created_by = that user
  insert into business_profile(workspace_id, name, created_by)
    values (v_ws_id, 'fk-test-profile', v_user_id)
    returning id into v_row_id;

  -- delete the user
  delete from auth.users where id = v_user_id;

  -- check created_by is now null
  select created_by into v_created from business_profile where id = v_row_id;

  if v_created is not null then
    raise exception 'ON DELETE SET NULL did not fire: created_by = %', v_created;
  end if;
end $$;

select ok(true, 'ON DELETE SET NULL: deleting auth.users row sets business_profile.created_by to NULL');

select * from finish();
rollback;
