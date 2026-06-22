begin;
select plan(4);

-- C/D fixture: two tenants, each with an owner
insert into auth.users(id,email) values
  ('00000000-0000-0000-0000-0000000000c1','owner-c@test.dev'),
  ('00000000-0000-0000-0000-0000000000d1','owner-d@test.dev');
insert into workspaces(id,name,slug) values
  ('cccccccc-0000-0000-0000-000000000001','C Co','c-co'),
  ('dddddddd-0000-0000-0000-000000000001','D Co','d-co');
insert into workspace_members(workspace_id,user_id,role) values
  ('cccccccc-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1','owner'),
  ('dddddddd-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1','owner');

-- Seed: one manual and one auto improvement for workspace C (as superuser before role switch)
insert into improvements(id,workspace_id,source,title,status,created_by) values
  ('aaaaaaaa-0000-0000-0000-000000000009','cccccccc-0000-0000-0000-000000000001','manual','idea','open',
   '00000000-0000-0000-0000-0000000000c1');
insert into improvements(workspace_id,source,title,status,trigger_kind,dedup_key) values
  ('cccccccc-0000-0000-0000-000000000001','auto','auto1','open','untreated_high_risk','untreated_high_risk:x');

-- Test 3 (dedup): a second open auto row with the same dedup_key must fail with 23505
select throws_ok(
  $$insert into improvements(workspace_id,source,title,status,trigger_kind,dedup_key)
    values('cccccccc-0000-0000-0000-000000000001','auto','dup','open','untreated_high_risk','untreated_high_risk:x')$$,
  '23505', null, 'dedup blocks a second open auto-suggestion with same key');

-- Switch to owner C
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

-- Test 1: owner C sees 2 improvements (manual + auto)
select is((select count(*)::int from improvements), 2, 'owner C sees 2 improvements');

-- Test 2: member (C) can insert a manual improvement
select lives_ok(
  $$insert into improvements(workspace_id,source,title,status)
    values('cccccccc-0000-0000-0000-000000000001','manual','new idea','open')$$,
  'member can insert a manual improvement in own workspace');

-- Switch to owner D
set local "request.jwt.claims" =
  '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

-- Test 4: other tenant (D) sees 0 of C's improvements
select is((select count(*)::int from improvements
  where workspace_id='cccccccc-0000-0000-0000-000000000001'),
  0, 'other tenant cannot see C improvements');

select * from finish();
rollback;
