-- workspaces_insert_lockdown_test.sql
-- Direct INSERT into workspaces by `authenticated` must be denied (42501);
-- workspace creation must still work through the create_workspace RPC.
begin;
select plan(2);

insert into auth.users(id,email) values
  ('44444444-4444-4444-4444-444444444401','wslock@test.dev');

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"44444444-4444-4444-4444-444444444401","role":"authenticated"}';

-- (a) direct insert denied
select throws_ok(
  $$insert into workspaces(name,slug) values('rogue','rogue-slug')$$,
  '42501', null, 'authenticated cannot directly INSERT into workspaces');

-- (b) RPC still creates a workspace (returns a row with an id)
select isnt(
  (select row_to_json(public.create_workspace('Legit Co','legit-co-wslock')) ->> 'id'),
  null, 'create_workspace RPC still works for authenticated');

select * from finish();
rollback;
