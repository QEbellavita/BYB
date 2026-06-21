begin;
select plan(2);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1','c@test.dev');
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

select lives_ok(
  $$ select create_workspace('C Co','c-co') $$,
  'create_workspace runs for an authenticated user'
);
select is(
  (select role::text from workspace_members
   where user_id = '00000000-0000-0000-0000-0000000000c1'),
  'owner',
  'creator becomes owner'
);

select * from finish();
rollback;
