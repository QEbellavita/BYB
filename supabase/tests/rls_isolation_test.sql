-- rls_isolation_test.sql — CI GATE: prove cross-tenant isolation
begin;
select plan(2);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a','a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b','b@test.dev');
insert into workspaces (id, name, slug) values
  ('aaaaaaaa-0000-0000-0000-000000000001','A Co','a-co'),
  ('bbbbbbbb-0000-0000-0000-000000000001','B Co','b-co');
insert into workspace_members (workspace_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','owner'),
  ('bbbbbbbb-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b','owner');

-- act as user A
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select is(
  (select count(*)::int from workspaces),
  1,
  'user A sees only their own workspace'
);
select is(
  (select count(*)::int from workspaces where slug = 'b-co'),
  0,
  'user A cannot see workspace B'
);

select * from finish();
rollback;
