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
insert into risk_entries(id,workspace_id,title,likelihood,impact,created_by) values
  ('eeeeeeee-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','C risk',4,4,
   '00000000-0000-0000-0000-0000000000c1');

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is((select count(*)::int from risk_entries), 1, 'owner C sees own risk');
select lives_ok(
  $$insert into risk_entries(workspace_id,title,likelihood,impact)
    values('cccccccc-0000-0000-0000-000000000001','C risk 2',2,3)$$,
  'member can insert a risk in own workspace');

set local "request.jwt.claims" =
  '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select is((select count(*)::int from risk_entries
  where workspace_id='cccccccc-0000-0000-0000-000000000001'),
  0, 'other tenant cannot see C risks');

-- cross-tenant write-denial: D member cannot INSERT into C's workspace
select throws_ok(
  $$insert into risk_entries(workspace_id,title,likelihood,impact)
    values('cccccccc-0000-0000-0000-000000000001','evil risk',1,1)$$,
  '42501', null, 'risk_entries: foreign member cannot insert into another workspace');

-- cross-tenant write-denial: D member cannot UPDATE C's rows (USING hides them → 0 rows changed)
do $$
begin
  update risk_entries set title='pwned'
  where workspace_id='cccccccc-0000-0000-0000-000000000001';
end $$;
set local "request.jwt.claims" =
  '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is(
  (select title from risk_entries where id='eeeeeeee-0000-0000-0000-000000000001'),
  'C risk',
  'risk_entries: foreign member cannot update another workspace row');

select * from finish();
rollback;
