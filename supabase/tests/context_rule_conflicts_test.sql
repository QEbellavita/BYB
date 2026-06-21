begin;
select plan(3);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c7','c7@test.dev');
insert into workspaces (id, name, slug) values ('c7777777-0000-0000-0000-000000000001','C7 Co','c7-co');
insert into workspace_members (workspace_id, user_id, role)
  values ('c7777777-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c7','owner');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000c7","role":"authenticated"}';

-- base rule (active)
insert into business_rules (workspace_id, status, rule_type, area, statement, value, consequence, applies_to)
  values ('c7777777-0000-0000-0000-000000000001','active','value_setting','purchasing','max purchase',
          '1000'::jsonb,'approval','["manager"]'::jsonb);
-- divergent: same area+statement+overlap, different value
insert into business_rules (workspace_id, status, rule_type, area, statement, value, consequence, applies_to)
  values ('c7777777-0000-0000-0000-000000000001','active','value_setting','purchasing','max purchase',
          '2000'::jsonb,'approval','["manager","lead"]'::jsonb);
-- duplicate: identical value+consequence
insert into business_rules (workspace_id, status, rule_type, area, statement, value, consequence, applies_to)
  values ('c7777777-0000-0000-0000-000000000001','active','value_setting','purchasing','max purchase',
          '1000'::jsonb,'approval','["manager"]'::jsonb);
-- unrelated: different area -> no conflict
insert into business_rules (workspace_id, status, rule_type, area, statement, applies_to)
  values ('c7777777-0000-0000-0000-000000000001','active','must_do','safety','wear ppe','["staff"]'::jsonb);

select is((select count(*)::int from context_rule_conflicts('c7777777-0000-0000-0000-000000000001')),
          3, 'three conflicting pairs among the 3 purchasing rules');
select is((select count(*)::int from context_rule_conflicts('c7777777-0000-0000-0000-000000000001') where kind='divergent'),
          2, 'two divergent pairs (the 2000 rule vs each 1000 rule)');
select is((select count(*)::int from context_rule_conflicts('c7777777-0000-0000-0000-000000000001') where kind='duplicate'),
          1, 'one duplicate pair (the two identical 1000 rules)');

select * from finish();
rollback;
