-- audit_log_immutability_test.sql
-- Verifies audit_log is append-only: service_role can INSERT but cannot UPDATE or DELETE.
-- Also verifies authenticated role cannot INSERT, UPDATE, or DELETE.
begin;
select plan(6);

-- Seed as superuser (default role before set local)
insert into auth.users(id,email) values
  ('aaaaaaaa-0000-0000-0000-000000000001','audit-actor@test.dev');
insert into workspaces(id,name,slug) values
  ('bbbbbbbb-0000-0000-0000-000000000001','Audit Co','audit-co');

set local role service_role;

-- (1) service_role can INSERT a row
select lives_ok(
  $$insert into public.audit_log(workspace_id, actor, action, entity_type, entity_id)
    values(
      'bbbbbbbb-0000-0000-0000-000000000001',
      'aaaaaaaa-0000-0000-0000-000000000001',
      'insert',
      'workspaces',
      'bbbbbbbb-0000-0000-0000-000000000001'
    )$$,
  'service_role can INSERT into audit_log'
);

-- (2) service_role cannot UPDATE (append-only)
select throws_ok(
  $$update public.audit_log set action = 'tampered'$$,
  '42501',
  null,
  'service_role cannot UPDATE audit_log (42501)'
);

-- (3) service_role cannot DELETE (append-only)
select throws_ok(
  $$delete from public.audit_log$$,
  '42501',
  null,
  'service_role cannot DELETE from audit_log (42501)'
);

-- Switch to authenticated role to verify INSERT/UPDATE/DELETE are all denied (42501)
-- Set JWT claims so the role is valid; INSERT privilege is gone so it fails on privilege check
-- before RLS even runs.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

-- (4) authenticated cannot INSERT (privilege revoked)
select throws_ok(
  $$insert into public.audit_log(action) values('x')$$,
  '42501',
  null,
  'authenticated cannot INSERT into audit_log (42501)'
);

-- (5) authenticated cannot UPDATE
select throws_ok(
  $$update public.audit_log set action = 'tampered'$$,
  '42501',
  null,
  'authenticated cannot UPDATE audit_log (42501)'
);

-- (6) authenticated cannot DELETE
select throws_ok(
  $$delete from public.audit_log$$,
  '42501',
  null,
  'authenticated cannot DELETE from audit_log (42501)'
);

select * from finish();
rollback;
