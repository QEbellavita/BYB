begin;
select plan(6);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a7','a7@test.dev');
insert into workspaces (id, name, slug) values ('a7777777-0000-0000-0000-000000000001','A7 Co','a7-co');
insert into workspace_members (workspace_id, user_id, role)
  values ('a7777777-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a7','owner');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a7","role":"authenticated"}';

-- INSERT
insert into business_rules (workspace_id, rule_type, area, statement)
  values ('a7777777-0000-0000-0000-000000000001','must_do','finance','rule one');

select is((select version from business_rules where statement='rule one'), 1, 'insert sets version 1');
select is((select created_by from business_rules where statement='rule one'),
          '00000000-0000-0000-0000-0000000000a7'::uuid, 'insert stamps created_by');
select is((select count(*)::int from entity_versions
           where entity_type='business_rules' and version=1), 1, 'insert writes a version snapshot');
select is((select count(*)::int from context_events
           where type='business_rules.insert'), 1, 'insert enqueues an outbox event');

-- UPDATE
update business_rules set consequence='approval' where statement='rule one';
select is((select version from business_rules where statement='rule one'), 2, 'update bumps version to 2');
select is((select count(*)::int from context_events where type='business_rules.update'), 1, 'update enqueues an event');

select * from finish();
rollback;
