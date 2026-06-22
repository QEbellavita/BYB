-- audit_log_rls_test.sql
-- Verifies RLS on audit_log: workspace admin sees own rows; non-admin member sees 0; cross-tenant admin sees 0.
begin;
select plan(3);

-- Seed as superuser
insert into auth.users(id,email) values
  ('cccccccc-0000-0000-0000-000000000001','admin-ws-a@test.dev'),
  ('cccccccc-0000-0000-0000-000000000002','member-ws-a@test.dev'),
  ('cccccccc-0000-0000-0000-000000000003','admin-ws-b@test.dev');

insert into workspaces(id,name,slug) values
  ('dddddddd-0000-0000-0000-000000000001','WS-A','ws-a'),
  ('dddddddd-0000-0000-0000-000000000002','WS-B','ws-b');

-- WS-A owner (admin) + regular member
insert into workspace_members(workspace_id,user_id,role) values
  ('dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','owner'),
  ('dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002','staff');
-- WS-B owner (admin)
insert into workspace_members(workspace_id,user_id,role) values
  ('dddddddd-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000003','owner');

-- Seed one audit_log row in WS-A (as superuser/service_role insert)
insert into public.audit_log(workspace_id, actor, action, entity_type)
values (
  'dddddddd-0000-0000-0000-000000000001',
  'cccccccc-0000-0000-0000-000000000001',
  'insert',
  'workspaces'
);

-- (1) WS-A admin sees its own row (positive control).
-- NOTE: Data-change triggers (0019) also write audit rows for the seed inserts above,
-- so the exact count is > 1. We assert count >= 1 to prove admin access, not count.
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}';
select ok(
  (select count(*)::int from public.audit_log where workspace_id = 'dddddddd-0000-0000-0000-000000000001') >= 1,
  'WS-A admin sees at least one audit_log row in WS-A'
);

-- (2) WS-A non-admin member sees 0
set local "request.jwt.claims" =
  '{"sub":"cccccccc-0000-0000-0000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.audit_log where workspace_id = 'dddddddd-0000-0000-0000-000000000001'),
  0,
  'WS-A non-admin member sees 0 rows in audit_log'
);

-- (3) WS-B admin sees 0 rows from WS-A (cross-tenant isolation)
set local "request.jwt.claims" =
  '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}';
select is(
  (select count(*)::int from public.audit_log where workspace_id = 'dddddddd-0000-0000-0000-000000000001'),
  0,
  'WS-B admin sees 0 rows from WS-A audit_log (cross-tenant isolation)'
);

select * from finish();
rollback;
