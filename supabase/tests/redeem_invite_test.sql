begin;
select plan(2);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1','owner@test.dev'),
  ('00000000-0000-0000-0000-0000000000d2','invitee@test.dev');
insert into workspaces (id, name, slug) values
  ('dddddddd-0000-0000-0000-000000000001','D Co','d-co');
insert into workspace_members (workspace_id, user_id, role) values
  ('dddddddd-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1','owner');
insert into workspace_invites (workspace_id, email, role, token, invited_by) values
  ('dddddddd-0000-0000-0000-000000000001','invitee@test.dev','manager','tok-123',
   '00000000-0000-0000-0000-0000000000d1');

-- act as the invitee redeeming the token
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}';

select lives_ok(
  $$ select redeem_invite('tok-123') $$,
  'invitee can redeem a valid token'
);
select is(
  (select role::text from workspace_members
   where workspace_id = 'dddddddd-0000-0000-0000-000000000001'
     and user_id = '00000000-0000-0000-0000-0000000000d2'),
  'manager',
  'invitee joins with the invited role'
);

select * from finish();
rollback;
