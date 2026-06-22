-- audit_triggers_test.sql
-- TDD: RED before 0019_audit_triggers.sql is applied.
-- Verifies:
--   1. INSERT/UPDATE/DELETE on representative tables write audit_log rows with correct fields.
--   2. Catalog: audit_row_change trigger exists on all 18 tenant tables.
--   3. Catalog: audit_row_change trigger does NOT exist on 3 excluded tables.
begin;
select plan(21);

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-000000000a01', 'auditor@test.dev'),
  ('00000000-0000-0000-0000-000000000a02', 'member2@test.dev');
insert into workspaces(id, name, slug) values
  ('aaaaaaaa-aaaa-0000-0000-000000000001', 'Audit WS', 'audit-ws');
insert into workspace_members(workspace_id, user_id, role) values
  ('aaaaaaaa-aaaa-0000-0000-000000000001', '00000000-0000-0000-0000-000000000a01', 'owner');

-- Switch to authenticated workspace owner so auth.uid() resolves
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}';

-- ── 1. business_profile (Hub table) ──────────────────────────────────────────
insert into business_profile(id, workspace_id, name)
  values ('bbbbbbbb-0000-0000-0000-000000000001',
          'aaaaaaaa-aaaa-0000-0000-000000000001', 'Audit Co Profile');

-- (1) INSERT → audit row exists
select is(
  (select count(*)::int from audit_log
   where entity_type = 'business_profile'
     and entity_id   = 'bbbbbbbb-0000-0000-0000-000000000001'
     and action      = 'insert'),
  1,
  'business_profile INSERT → audit_log row'
);
-- (2) INSERT → actor = jwt sub
select is(
  (select actor from audit_log
   where entity_type = 'business_profile'
     and entity_id   = 'bbbbbbbb-0000-0000-0000-000000000001'
     and action      = 'insert'),
  '00000000-0000-0000-0000-000000000a01'::uuid,
  'business_profile INSERT → audit_log.actor = jwt sub'
);
-- (3) INSERT → after populated, before null
select is(
  (select (before is null and after is not null) from audit_log
   where entity_type = 'business_profile'
     and entity_id   = 'bbbbbbbb-0000-0000-0000-000000000001'
     and action      = 'insert'),
  true,
  'business_profile INSERT → before=null, after=populated'
);

-- UPDATE business_profile
update business_profile
  set name = 'Audit Co Profile Updated'
  where id = 'bbbbbbbb-0000-0000-0000-000000000001';

-- (4) UPDATE → audit row
select is(
  (select count(*)::int from audit_log
   where entity_type = 'business_profile'
     and entity_id   = 'bbbbbbbb-0000-0000-0000-000000000001'
     and action      = 'update'),
  1,
  'business_profile UPDATE → audit_log row'
);
-- (5) UPDATE → both before and after populated
select is(
  (select (before is not null and after is not null) from audit_log
   where entity_type = 'business_profile'
     and entity_id   = 'bbbbbbbb-0000-0000-0000-000000000001'
     and action      = 'update'),
  true,
  'business_profile UPDATE → before=populated, after=populated'
);

-- DELETE business_profile
delete from business_profile
  where id = 'bbbbbbbb-0000-0000-0000-000000000001';

-- (6) DELETE → audit row
select is(
  (select count(*)::int from audit_log
   where entity_type = 'business_profile'
     and entity_id   = 'bbbbbbbb-0000-0000-0000-000000000001'
     and action      = 'delete'),
  1,
  'business_profile DELETE → audit_log row'
);
-- (7) DELETE → before populated, after null
select is(
  (select (before is not null and after is null) from audit_log
   where entity_type = 'business_profile'
     and entity_id   = 'bbbbbbbb-0000-0000-0000-000000000001'
     and action      = 'delete'),
  true,
  'business_profile DELETE → before=populated, after=null'
);

-- ── 2. risk_entries (SP-3 table) ─────────────────────────────────────────────
insert into risk_entries(id, workspace_id, title, likelihood, impact)
  values ('cccccccc-0000-0000-0000-000000000001',
          'aaaaaaaa-aaaa-0000-0000-000000000001', 'Audit Risk', 2, 3);

-- (8) risk_entries INSERT → audit row with correct entity_type
select is(
  (select count(*)::int from audit_log
   where entity_type = 'risk_entries'
     and entity_id   = 'cccccccc-0000-0000-0000-000000000001'
     and action      = 'insert'),
  1,
  'risk_entries INSERT → audit_log row'
);

-- (9) risk_entries INSERT → entity_id matches
select is(
  (select entity_id from audit_log
   where entity_type = 'risk_entries'
     and action      = 'insert'
     and entity_id   = 'cccccccc-0000-0000-0000-000000000001'),
  'cccccccc-0000-0000-0000-000000000001'::uuid,
  'risk_entries INSERT → audit_log.entity_id correct'
);

-- ── 3. workspace_members (workspace-core table, no id column) ─────────────────
-- workspace_members has no id; entity_id will be null; workspace_id populated
-- Insert as admin (owner) — switch back to owner context (already set)
insert into workspace_members(workspace_id, user_id, role)
  values ('aaaaaaaa-aaaa-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000a02', 'staff');

-- (10) workspace_members INSERT → audit row exists with actor = jwt sub
-- (The fixture owner-row insert fires the trigger too, but actor=null there;
--  we assert ≥1 row where actor matches our authenticated user.)
select is(
  (select count(*)::int from audit_log
   where entity_type  = 'workspace_members'
     and workspace_id = 'aaaaaaaa-aaaa-0000-0000-000000000001'
     and action       = 'insert'
     and actor        = '00000000-0000-0000-0000-000000000a01'),
  1,
  'workspace_members INSERT → audit_log row with actor = jwt sub'
);

-- (11) workspace_members INSERT → entity_id is null (composite PK table has no id)
select is(
  (select entity_id from audit_log
   where entity_type  = 'workspace_members'
     and workspace_id = 'aaaaaaaa-aaaa-0000-0000-000000000001'
     and action       = 'insert'
     and actor        = '00000000-0000-0000-0000-000000000a01'),
  null::uuid,
  'workspace_members INSERT → entity_id is null (no id column)'
);

-- ── 4. onboarding_sessions (onboarding table) ─────────────────────────────────
insert into onboarding_sessions(id, workspace_id, started_by)
  values ('dddddddd-0000-0000-0000-000000000001',
          'aaaaaaaa-aaaa-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000a01');

-- (12) onboarding_sessions INSERT → audit row
select is(
  (select count(*)::int from audit_log
   where entity_type = 'onboarding_sessions'
     and entity_id   = 'dddddddd-0000-0000-0000-000000000001'
     and action      = 'insert'),
  1,
  'onboarding_sessions INSERT → audit_log row'
);

-- (13) onboarding_sessions: entity_id populated correctly
select is(
  (select entity_id from audit_log
   where entity_type = 'onboarding_sessions'
     and action      = 'insert'),
  'dddddddd-0000-0000-0000-000000000001'::uuid,
  'onboarding_sessions INSERT → entity_id correct'
);

-- ── 5. Catalog: trigger exists on all 18 tenant tables ───────────────────────
-- Count distinct tables that have the _audit trigger (one trigger fires INSERT+UPDATE+DELETE
-- but appears as 3 rows in information_schema.triggers — use count(distinct)).
select is(
  (select count(distinct event_object_table)::int
   from information_schema.triggers
   where trigger_schema = 'public'
     and trigger_name like '%audit%'
     and event_object_table in (
       'business_profile','business_rules','compliance_obligations',
       'internal_processes','decision_logic','risk_frameworks','governance','org_people'
     )),
  8,
  'audit_row_change trigger exists on all 8 Hub tables'
);

select is(
  (select count(distinct event_object_table)::int
   from information_schema.triggers
   where trigger_schema = 'public'
     and trigger_name like '%audit%'
     and event_object_table in ('risk_entries','complaints','improvements')),
  3,
  'audit_row_change trigger exists on all 3 SP-3 tables'
);

select is(
  (select count(distinct event_object_table)::int
   from information_schema.triggers
   where trigger_schema = 'public'
     and trigger_name like '%audit%'
     and event_object_table in (
       'workspaces','workspace_members','workspace_invites','workspace_features'
     )),
  4,
  'audit_row_change trigger exists on all 4 workspace-core tables'
);

select is(
  (select count(distinct event_object_table)::int
   from information_schema.triggers
   where trigger_schema = 'public'
     and trigger_name like '%audit%'
     and event_object_table in (
       'onboarding_sessions','onboarding_invite_drafts','context_links'
     )),
  3,
  'audit_row_change trigger exists on onboarding + context_links tables'
);

-- ── 6. Catalog: trigger does NOT exist on 3 excluded tables ──────────────────
select is(
  (select count(*)::int
   from information_schema.triggers
   where trigger_schema = 'public'
     and trigger_name like '%audit%'
     and event_object_table = 'entity_versions'),
  0,
  'audit_row_change trigger NOT on entity_versions'
);

select is(
  (select count(*)::int
   from information_schema.triggers
   where trigger_schema = 'public'
     and trigger_name like '%audit%'
     and event_object_table = 'context_events'),
  0,
  'audit_row_change trigger NOT on context_events'
);

select is(
  (select count(*)::int
   from information_schema.triggers
   where trigger_schema = 'public'
     and trigger_name like '%audit%'
     and event_object_table = 'audit_log'),
  0,
  'audit_row_change trigger NOT on audit_log'
);

-- ── 7. Workspace-id correctness on workspaces table itself ───────────────────
-- workspaces has no workspace_id col; the trigger uses id as workspace_id
-- We insert a workspace as superuser (reset role first)
reset role;
insert into workspaces(id, name, slug) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'Test WS', 'test-ws-audit');

select is(
  (select workspace_id from audit_log
   where entity_type = 'workspaces'
     and entity_id   = 'eeeeeeee-0000-0000-0000-000000000001'
     and action      = 'insert'),
  'eeeeeeee-0000-0000-0000-000000000001'::uuid,
  'workspaces INSERT → audit_log.workspace_id = workspaces.id'
);

select * from finish();
rollback;
