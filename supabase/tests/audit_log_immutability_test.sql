-- audit_log_immutability_test.sql
-- Verifies audit_log is append-only: service_role can INSERT but cannot UPDATE or DELETE.
begin;
select plan(3);

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

select * from finish();
rollback;
