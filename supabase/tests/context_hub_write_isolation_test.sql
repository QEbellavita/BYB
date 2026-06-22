-- context_hub_write_isolation_test.sql
-- Cross-tenant write-denial for Hub entity tables:
--   business_profile, business_rules, org_people, compliance_obligations,
--   internal_processes, decision_logic, risk_frameworks, governance,
--   entity_versions, context_events, context_links
-- Each table is covered by an "for all ... with check (is_workspace_member)" policy
-- so a foreign workspace's member must receive 42501 on INSERT and 0 rows on UPDATE.
begin;
select plan(22);

insert into auth.users(id,email) values
  ('11111111-1111-1111-1111-111111111101','owner-g@test.dev'),
  ('11111111-1111-1111-1111-111111111102','owner-h@test.dev');
insert into workspaces(id,name,slug) values
  ('22222222-2222-2222-2222-222222222201','G Co','g-co'),
  ('22222222-2222-2222-2222-222222222202','H Co','h-co');
insert into workspace_members(workspace_id,user_id,role) values
  ('22222222-2222-2222-2222-222222222201','11111111-1111-1111-1111-111111111101','owner'),
  ('22222222-2222-2222-2222-222222222202','11111111-1111-1111-1111-111111111102','owner');

-- seed rows in G workspace as superuser (before role switch) for update-denial checks
insert into business_profile(id,workspace_id,name) values
  ('33333333-3333-3333-3333-333333333301','22222222-2222-2222-2222-222222222201','G profile');
insert into business_rules(id,workspace_id,rule_type,area,statement) values
  ('33333333-3333-3333-3333-333333333302','22222222-2222-2222-2222-222222222201','must_do','hr','G rule');
insert into org_people(id,workspace_id,person_name) values
  ('33333333-3333-3333-3333-333333333303','22222222-2222-2222-2222-222222222201','G Person');
insert into compliance_obligations(id,workspace_id,name) values
  ('33333333-3333-3333-3333-333333333304','22222222-2222-2222-2222-222222222201','G Obligation');
insert into internal_processes(id,workspace_id,title) values
  ('33333333-3333-3333-3333-333333333305','22222222-2222-2222-2222-222222222201','G process');
insert into decision_logic(id,workspace_id,name) values
  ('33333333-3333-3333-3333-333333333306','22222222-2222-2222-2222-222222222201','G logic');
insert into risk_frameworks(id,workspace_id,name) values
  ('33333333-3333-3333-3333-333333333307','22222222-2222-2222-2222-222222222201','G framework');
insert into governance(id,workspace_id,name,kind) values
  ('33333333-3333-3333-3333-333333333308','22222222-2222-2222-2222-222222222201','G governance','committee');
insert into entity_versions(id,workspace_id,entity_type,entity_id,version,snapshot,status) values
  ('33333333-3333-3333-3333-333333333309','22222222-2222-2222-2222-222222222201','business_rules',gen_random_uuid(),1,'{}','active');
insert into context_events(id,workspace_id,type,entity_type,entity_id) values
  ('33333333-3333-3333-3333-333333333310','22222222-2222-2222-2222-222222222201','business_rules.insert','business_rules',gen_random_uuid());
insert into context_links(id,workspace_id,from_type,from_id,to_type,to_id,relation) values
  ('33333333-3333-3333-3333-333333333311','22222222-2222-2222-2222-222222222201','business_rules',gen_random_uuid(),'compliance_obligations',gen_random_uuid(),'G relation');

-- switch to H (foreign tenant)
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-1111-1111-111111111102","role":"authenticated"}';

-- INSERT-denial assertions (with check → 42501)
select throws_ok(
  $$insert into business_profile(workspace_id,name)
    values('22222222-2222-2222-2222-222222222201','injected')$$,
  '42501', null, 'business_profile: foreign member cannot insert into another workspace');

select throws_ok(
  $$insert into business_rules(workspace_id,rule_type,area,statement)
    values('22222222-2222-2222-2222-222222222201','must_do','evil','injected')$$,
  '42501', null, 'business_rules: foreign member cannot insert into another workspace');

select throws_ok(
  $$insert into org_people(workspace_id,person_name)
    values('22222222-2222-2222-2222-222222222201','injected')$$,
  '42501', null, 'org_people: foreign member cannot insert into another workspace');

select throws_ok(
  $$insert into compliance_obligations(workspace_id,name)
    values('22222222-2222-2222-2222-222222222201','injected')$$,
  '42501', null, 'compliance_obligations: foreign member cannot insert into another workspace');

select throws_ok(
  $$insert into internal_processes(workspace_id,title)
    values('22222222-2222-2222-2222-222222222201','injected')$$,
  '42501', null, 'internal_processes: foreign member cannot insert into another workspace');

select throws_ok(
  $$insert into decision_logic(workspace_id,name)
    values('22222222-2222-2222-2222-222222222201','injected')$$,
  '42501', null, 'decision_logic: foreign member cannot insert into another workspace');

select throws_ok(
  $$insert into risk_frameworks(workspace_id,name)
    values('22222222-2222-2222-2222-222222222201','injected')$$,
  '42501', null, 'risk_frameworks: foreign member cannot insert into another workspace');

select throws_ok(
  $$insert into governance(workspace_id,name,kind)
    values('22222222-2222-2222-2222-222222222201','injected','committee')$$,
  '42501', null, 'governance: foreign member cannot insert into another workspace');

select throws_ok(
  $$insert into entity_versions(workspace_id,entity_type,entity_id,version,snapshot,status)
    values('22222222-2222-2222-2222-222222222201','business_rules',gen_random_uuid(),1,'{}','active')$$,
  '42501', null, 'entity_versions: foreign member cannot insert into another workspace');

select throws_ok(
  $$insert into context_events(workspace_id,type,entity_type,entity_id)
    values('22222222-2222-2222-2222-222222222201','business_rules.insert','business_rules',gen_random_uuid())$$,
  '42501', null, 'context_events: foreign member cannot insert into another workspace');

select throws_ok(
  $$insert into context_links(workspace_id,from_type,from_id,to_type,to_id)
    values('22222222-2222-2222-2222-222222222201','business_rules',gen_random_uuid(),'compliance_obligations',gen_random_uuid())$$,
  '42501', null, 'context_links: foreign member cannot insert into another workspace');

-- UPDATE-denial assertions (USING hides foreign rows → 0 rows changed; swallow error, read back as owner)
do $$
begin
  update business_profile set name='pwned'
  where workspace_id='22222222-2222-2222-2222-222222222201';
end $$;

do $$
begin
  update business_rules set statement='pwned'
  where workspace_id='22222222-2222-2222-2222-222222222201';
end $$;

do $$
begin
  update org_people set person_name='pwned'
  where workspace_id='22222222-2222-2222-2222-222222222201';
end $$;

do $$
begin
  update compliance_obligations set name='pwned'
  where workspace_id='22222222-2222-2222-2222-222222222201';
end $$;

do $$
begin
  update internal_processes set title='pwned'
  where workspace_id='22222222-2222-2222-2222-222222222201';
end $$;

do $$
begin
  update decision_logic set name='pwned'
  where workspace_id='22222222-2222-2222-2222-222222222201';
end $$;

do $$
begin
  update risk_frameworks set name='pwned'
  where workspace_id='22222222-2222-2222-2222-222222222201';
end $$;

do $$
begin
  update governance set name='pwned'
  where workspace_id='22222222-2222-2222-2222-222222222201';
end $$;

do $$
begin
  update entity_versions set snapshot='{"pwned":true}'::jsonb
  where workspace_id='22222222-2222-2222-2222-222222222201';
end $$;

do $$
begin
  update context_events set type='pwned'
  where workspace_id='22222222-2222-2222-2222-222222222201';
end $$;

do $$
begin
  update context_links set relation='pwned'
  where workspace_id='22222222-2222-2222-2222-222222222201';
end $$;

-- switch to G owner to read back values
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-1111-1111-111111111101","role":"authenticated"}';

select is(
  (select name from business_profile where id='33333333-3333-3333-3333-333333333301'),
  'G profile',
  'business_profile: foreign member cannot update another workspace row');

select is(
  (select statement from business_rules where id='33333333-3333-3333-3333-333333333302'),
  'G rule',
  'business_rules: foreign member cannot update another workspace row');

select is(
  (select person_name from org_people where id='33333333-3333-3333-3333-333333333303'),
  'G Person',
  'org_people: foreign member cannot update another workspace row');

select is(
  (select name from compliance_obligations where id='33333333-3333-3333-3333-333333333304'),
  'G Obligation',
  'compliance_obligations: foreign member cannot update another workspace row');

select is(
  (select title from internal_processes where id='33333333-3333-3333-3333-333333333305'),
  'G process',
  'internal_processes: foreign member cannot update another workspace row');

select is(
  (select name from decision_logic where id='33333333-3333-3333-3333-333333333306'),
  'G logic',
  'decision_logic: foreign member cannot update another workspace row');

select is(
  (select name from risk_frameworks where id='33333333-3333-3333-3333-333333333307'),
  'G framework',
  'risk_frameworks: foreign member cannot update another workspace row');

select is(
  (select name from governance where id='33333333-3333-3333-3333-333333333308'),
  'G governance',
  'governance: foreign member cannot update another workspace row');

select is(
  (select snapshot from entity_versions where id='33333333-3333-3333-3333-333333333309'),
  '{}'::jsonb,
  'entity_versions: foreign member cannot update another workspace row');

select is(
  (select type from context_events where id='33333333-3333-3333-3333-333333333310'),
  'business_rules.insert',
  'context_events: foreign member cannot update another workspace row');

select is(
  (select relation from context_links where id='33333333-3333-3333-3333-333333333311'),
  'G relation',
  'context_links: foreign member cannot update another workspace row');

select * from finish();
rollback;
