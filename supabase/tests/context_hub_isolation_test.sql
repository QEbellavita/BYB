-- context_hub_isolation_test.sql — cross-tenant isolation across Hub tables
begin;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1','f1@test.dev'),
  ('00000000-0000-0000-0000-0000000000f2','f2@test.dev');
insert into workspaces (id, name, slug) values
  ('ffffffff-0000-0000-0000-000000000001','F1 Co','f1-co'),
  ('ffffffff-0000-0000-0000-000000000002','F2 Co','f2-co');
insert into workspace_members (workspace_id, user_id, role) values
  ('ffffffff-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000f1','owner'),
  ('ffffffff-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000f2','owner');

-- seed one row per entity in F2 (insert as superuser; triggers from Task 3 not yet present)
insert into business_profile (workspace_id, name) values ('ffffffff-0000-0000-0000-000000000002','F2 profile');
insert into business_rules (workspace_id, rule_type, area, statement) values ('ffffffff-0000-0000-0000-000000000002','must_do','hr','x');
insert into compliance_obligations (workspace_id, name) values ('ffffffff-0000-0000-0000-000000000002','WHS');
insert into internal_processes (workspace_id, title) values ('ffffffff-0000-0000-0000-000000000002','Onboard');
insert into decision_logic (workspace_id, name) values ('ffffffff-0000-0000-0000-000000000002','Approve');
insert into risk_frameworks (workspace_id, name) values ('ffffffff-0000-0000-0000-000000000002','Ops risk');
insert into governance (workspace_id, name, kind) values ('ffffffff-0000-0000-0000-000000000002','Board','committee');
insert into org_people (workspace_id, person_name) values ('ffffffff-0000-0000-0000-000000000002','Jane');

insert into entity_versions (workspace_id, entity_type, entity_id, version, snapshot, status)
  values ('ffffffff-0000-0000-0000-000000000002','business_rules', gen_random_uuid(), 1, '{}'::jsonb, 'active');
insert into context_events (workspace_id, type, entity_type, entity_id)
  values ('ffffffff-0000-0000-0000-000000000002','business_rules.insert','business_rules', gen_random_uuid());
insert into context_links (workspace_id, from_type, from_id, to_type, to_id)
  values ('ffffffff-0000-0000-0000-000000000002','business_rules', gen_random_uuid(),'compliance_obligations', gen_random_uuid());

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

select is((select count(*)::int from business_profile       where workspace_id='ffffffff-0000-0000-0000-000000000002'),0,'iso business_profile');
select is((select count(*)::int from business_rules         where workspace_id='ffffffff-0000-0000-0000-000000000002'),0,'iso business_rules');
select is((select count(*)::int from compliance_obligations where workspace_id='ffffffff-0000-0000-0000-000000000002'),0,'iso compliance_obligations');
select is((select count(*)::int from internal_processes     where workspace_id='ffffffff-0000-0000-0000-000000000002'),0,'iso internal_processes');
select is((select count(*)::int from decision_logic         where workspace_id='ffffffff-0000-0000-0000-000000000002'),0,'iso decision_logic');
select is((select count(*)::int from risk_frameworks        where workspace_id='ffffffff-0000-0000-0000-000000000002'),0,'iso risk_frameworks');
select is((select count(*)::int from governance             where workspace_id='ffffffff-0000-0000-0000-000000000002'),0,'iso governance');
select is((select count(*)::int from org_people             where workspace_id='ffffffff-0000-0000-0000-000000000002'),0,'iso org_people');
select is((select count(*)::int from entity_versions where workspace_id='ffffffff-0000-0000-0000-000000000002'),0,'iso entity_versions');
select is((select count(*)::int from context_events  where workspace_id='ffffffff-0000-0000-0000-000000000002'),0,'iso context_events');
select is((select count(*)::int from context_links   where workspace_id='ffffffff-0000-0000-0000-000000000002'),0,'iso context_links');

select * from finish();
rollback;
