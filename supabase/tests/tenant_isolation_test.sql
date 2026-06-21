-- tenant_isolation_test.sql — cross-tenant isolation for members/invites/features
begin;
select plan(3);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1','e1@test.dev'),
  ('00000000-0000-0000-0000-0000000000e2','e2@test.dev');
insert into workspaces (id, name, slug) values
  ('eeeeeeee-0000-0000-0000-000000000001','E1 Co','e1-co'),
  ('eeeeeeee-0000-0000-0000-000000000002','E2 Co','e2-co');
insert into workspace_members (workspace_id, user_id, role) values
  ('eeeeeeee-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1','owner'),
  ('eeeeeeee-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000e2','owner');
insert into workspace_invites (workspace_id, email, role, token, invited_by) values
  ('eeeeeeee-0000-0000-0000-000000000002','x@test.dev','staff','tok-e2',
   '00000000-0000-0000-0000-0000000000e2');
insert into workspace_features (workspace_id, module_id, enabled) values
  ('eeeeeeee-0000-0000-0000-000000000002','risk', true);

-- act as user E1 (only a member of workspace E1)
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

select is(
  (select count(*)::int from workspace_members
   where workspace_id = 'eeeeeeee-0000-0000-0000-000000000002'),
  0, 'E1 cannot see E2 workspace_members');
select is(
  (select count(*)::int from workspace_invites),
  0, 'E1 cannot see E2 workspace_invites');
select is(
  (select count(*)::int from workspace_features),
  0, 'E1 cannot see E2 workspace_features');

select * from finish();
rollback;
