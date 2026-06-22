begin;
select plan(5);
insert into auth.users(id,email) values
  ('00000000-0000-0000-0000-0000000000c1','owner-c@test.dev'),
  ('00000000-0000-0000-0000-0000000000d1','owner-d@test.dev');
insert into workspaces(id,name,slug) values
  ('cccccccc-0000-0000-0000-000000000001','C Co','c-co'),
  ('dddddddd-0000-0000-0000-000000000001','D Co','d-co');
insert into workspace_members(workspace_id,user_id,role) values
  ('cccccccc-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1','owner'),
  ('dddddddd-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1','owner');
insert into complaints(id,workspace_id,reference,description,created_by) values
  ('ffffffff-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','C-001','late delivery',
   '00000000-0000-0000-0000-0000000000c1');

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is((select count(*)::int from complaints), 1, 'owner C sees own complaint');
select lives_ok(
  $$insert into complaints(workspace_id,reference,description)
    values('cccccccc-0000-0000-0000-000000000001','C-002','billing error')$$,
  'member can insert a complaint in own workspace');

set local "request.jwt.claims" =
  '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select is((select count(*)::int from complaints
  where workspace_id='cccccccc-0000-0000-0000-000000000001'),
  0, 'other tenant cannot see C complaints');

-- cross-tenant write-denial: D member cannot INSERT into C's workspace
select throws_ok(
  $$insert into complaints(workspace_id,reference,description)
    values('cccccccc-0000-0000-0000-000000000001','C-EVIL','injected complaint')$$,
  '42501', null, 'complaints: foreign member cannot insert into another workspace');

-- cross-tenant write-denial: D member cannot UPDATE C's rows (USING hides them → 0 rows changed)
do $$
begin
  update complaints set description='pwned'
  where workspace_id='cccccccc-0000-0000-0000-000000000001';
end $$;
set local "request.jwt.claims" =
  '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is(
  (select description from complaints where id='ffffffff-0000-0000-0000-000000000001'),
  'late delivery',
  'complaints: foreign member cannot update another workspace row');

select * from finish();
rollback;
