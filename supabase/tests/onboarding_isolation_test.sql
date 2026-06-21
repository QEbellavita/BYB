begin;
select plan(7);

insert into auth.users(id,email) values
  ('00000000-0000-0000-0000-0000000000a1','owner-a@test.dev'),
  ('00000000-0000-0000-0000-0000000000a2','staff-a@test.dev'),
  ('00000000-0000-0000-0000-0000000000a3','admin-a@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1','owner-b@test.dev');
insert into workspaces(id, name, slug) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'A', 'a'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'B', 'b');
insert into workspace_members(workspace_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','owner'),
  ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','staff'),
  ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a3','admin'),
  ('bbbbbbbb-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','owner');
insert into org_people(id,workspace_id,person_name,email) values
  ('aaaaaaaa-0000-0000-0000-000000000011',
   'aaaaaaaa-0000-0000-0000-000000000001','Invitee','invitee@test.dev');

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"00000000-0000-0000-0000-0000000000a1","email":"owner-a@test.dev","role":"authenticated"}';
select lives_ok(
  $$insert into onboarding_sessions(id,workspace_id,started_by)
    values (
      'aaaaaaaa-0000-0000-0000-000000000021',
      'aaaaaaaa-0000-0000-0000-000000000001',
      auth.uid()
    )$$,
  'owner can create onboarding session'
);

set local "request.jwt.claims" =
  '{"sub":"00000000-0000-0000-0000-0000000000a3","email":"admin-a@test.dev","role":"authenticated"}';
select lives_ok(
  $$update workspace_members set role='manager'
    where workspace_id='aaaaaaaa-0000-0000-0000-000000000001'
      and user_id='00000000-0000-0000-0000-0000000000a2'$$,
  'admin can update membership'
);

set local "request.jwt.claims" =
  '{"sub":"00000000-0000-0000-0000-0000000000a2","email":"staff-a@test.dev","role":"authenticated"}';

-- staff cannot promote: perform the update, then check role is unchanged
do $$
begin
  update workspace_members set role='admin'
  where workspace_id='aaaaaaaa-0000-0000-0000-000000000001'
    and user_id='00000000-0000-0000-0000-0000000000a2';
end $$;
select is(
  (select role::text from workspace_members
    where workspace_id='aaaaaaaa-0000-0000-0000-000000000001'
      and user_id='00000000-0000-0000-0000-0000000000a2'),
  'manager',
  'staff cannot promote membership'
);

-- staff cannot update onboarding: attempt the write (swallow error), then verify value is unchanged
do $$
begin
  update onboarding_sessions set current_step='rules'
  where workspace_id='aaaaaaaa-0000-0000-0000-000000000001';
exception when others then null;
end $$;

-- switch to owner to read back the value (staff cannot see the row)
set local "request.jwt.claims" =
  '{"sub":"00000000-0000-0000-0000-0000000000a1","email":"owner-a@test.dev","role":"authenticated"}';
select is(
  (select current_step::text from onboarding_sessions
    where workspace_id='aaaaaaaa-0000-0000-0000-000000000001'),
  'profile',
  'staff cannot update onboarding (current_step unchanged)'
);
-- restore staff context for subsequent assertions
set local "request.jwt.claims" =
  '{"sub":"00000000-0000-0000-0000-0000000000a2","email":"staff-a@test.dev","role":"authenticated"}';

select throws_ok(
  $$insert into onboarding_invite_drafts(
      workspace_id,session_id,org_person_id,email,role
    ) values (
      'aaaaaaaa-0000-0000-0000-000000000001',
      'aaaaaaaa-0000-0000-0000-000000000021',
      'aaaaaaaa-0000-0000-0000-000000000011',
      'invitee@test.dev','staff'
    )$$,
  '42501', null, 'staff cannot queue onboarding invite'
);

set local "request.jwt.claims" =
  '{"sub":"00000000-0000-0000-0000-0000000000b1","email":"owner-b@test.dev","role":"authenticated"}';
select is(
  (select count(*)::int from onboarding_sessions
    where workspace_id='aaaaaaaa-0000-0000-0000-000000000001'),
  0, 'other tenant cannot see onboarding session'
);
select is(
  (select count(*)::int from onboarding_invite_drafts
    where workspace_id='aaaaaaaa-0000-0000-0000-000000000001'),
  0, 'other tenant cannot see onboarding invite drafts'
);

select * from finish();
rollback;
