begin;
select plan(26);

-- ─── All fixtures inserted as superuser (postgres role) ──────────────────────

-- Auth users
insert into auth.users(id, email) values
  ('cccccccc-0000-0000-0000-0000000000c1', 'owner-c@test.dev'),
  ('cccccccc-0000-0000-0000-0000000000c2', 'staff-c@test.dev'),
  ('dddddddd-0000-0000-0000-0000000000d1', 'owner-d@test.dev'),
  ('eeeeeeee-0000-0000-0000-0000000000e1', 'owner-e@test.dev');

-- ─── Workspace C: happy-path workspace ───────────────────────────────────────
insert into workspaces(id, name, slug) values
  ('cccccccc-0000-0000-0000-000000000002', 'C Corp', 'c-corp');
insert into workspace_members(workspace_id, user_id, role) values
  ('cccccccc-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-0000000000c1', 'owner'),
  ('cccccccc-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-0000000000c2', 'staff');
insert into onboarding_sessions(id, workspace_id, started_by, status, completed_steps) values
  ('cccccccc-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000002',
   'cccccccc-0000-0000-0000-0000000000c1',
   'in_progress',
   '["profile","rules","industry","people"]'::jsonb);
insert into business_profile(id, workspace_id, name, status) values
  ('cccccccc-0000-0000-0000-000000000010',
   'cccccccc-0000-0000-0000-000000000002',
   'C Corp Profile', 'draft');
insert into business_rules(id, workspace_id, rule_type, area, statement, applies_to, status) values
  ('cccccccc-0000-0000-0000-000000000021',
   'cccccccc-0000-0000-0000-000000000002',
   'must_do', 'safety', 'wear ppe', '["staff"]'::jsonb, 'draft'),
  ('cccccccc-0000-0000-0000-000000000022',
   'cccccccc-0000-0000-0000-000000000002',
   'must_do', 'finance', 'file tax returns', '["owner"]'::jsonb, 'draft');
insert into org_people(id, workspace_id, person_name, email, status) values
  ('cccccccc-0000-0000-0000-000000000030',
   'cccccccc-0000-0000-0000-000000000002',
   'Alice Invited', 'alice@test.dev', 'draft');
insert into compliance_obligations(id, workspace_id, name, status) values
  ('cccccccc-0000-0000-0000-000000000040',
   'cccccccc-0000-0000-0000-000000000002',
   'GST Registration', 'draft');
insert into onboarding_invite_drafts(id, workspace_id, session_id, org_person_id, email, role, status) values
  ('cccccccc-0000-0000-0000-000000000050',
   'cccccccc-0000-0000-0000-000000000002',
   'cccccccc-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000030',
   'alice@test.dev', 'staff', 'queued');

-- ─── Workspace D: incomplete-steps negative-test workspace ───────────────────
insert into workspaces(id, name, slug) values
  ('dddddddd-0000-0000-0000-000000000002', 'D Corp', 'd-corp');
insert into workspace_members(workspace_id, user_id, role) values
  ('dddddddd-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-0000000000d1', 'owner');
insert into onboarding_sessions(id, workspace_id, started_by, status, completed_steps) values
  ('dddddddd-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000002',
   'dddddddd-0000-0000-0000-0000000000d1',
   'in_progress',
   '["profile","rules"]'::jsonb);
insert into business_profile(workspace_id, name, status) values
  ('dddddddd-0000-0000-0000-000000000002', 'D Corp Profile', 'draft');
insert into compliance_obligations(workspace_id, name, status) values
  ('dddddddd-0000-0000-0000-000000000002', 'GST Registration', 'draft');

-- ─── Workspace E: divergent-rules negative-test workspace ────────────────────
-- Rules are seeded as draft; complete_onboarding activates them, then the
-- relocated divergent-rules guard fires and rolls back the whole transaction.
insert into workspaces(id, name, slug) values
  ('eeeeeeee-0000-0000-0000-000000000002', 'E Corp', 'e-corp');
insert into workspace_members(workspace_id, user_id, role) values
  ('eeeeeeee-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-0000000000e1', 'owner');
insert into onboarding_sessions(id, workspace_id, started_by, status, completed_steps) values
  ('eeeeeeee-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000002',
   'eeeeeeee-0000-0000-0000-0000000000e1',
   'in_progress',
   '["profile","rules","industry","people"]'::jsonb);
insert into business_profile(id, workspace_id, name, status) values
  ('eeeeeeee-0000-0000-0000-000000000010',
   'eeeeeeee-0000-0000-0000-000000000002',
   'E Corp Profile', 'draft');
insert into org_people(id, workspace_id, person_name, email, status) values
  ('eeeeeeee-0000-0000-0000-000000000030',
   'eeeeeeee-0000-0000-0000-000000000002',
   'Eve Person', 'eve@test.dev', 'draft');
insert into compliance_obligations(workspace_id, name, status) values
  ('eeeeeeee-0000-0000-0000-000000000002', 'GST Registration', 'draft');
-- Divergent DRAFT rules: same area+statement+overlapping applies_to, different value.
-- complete_onboarding will activate these, then the guard catches the divergence.
insert into business_rules(workspace_id, rule_type, area, statement, value, consequence, applies_to, status) values
  ('eeeeeeee-0000-0000-0000-000000000002', 'value_setting', 'purchasing', 'max purchase',
   '1000'::jsonb, 'approval', '["manager"]'::jsonb, 'draft'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'value_setting', 'purchasing', 'max purchase',
   '2000'::jsonb, 'approval', '["manager"]'::jsonb, 'draft');

-- ─── Negative test 1: staff caller denied ────────────────────────────────────

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"cccccccc-0000-0000-0000-0000000000c2","email":"staff-c@test.dev","role":"authenticated"}';

select throws_ok(
  $$select complete_onboarding('cccccccc-0000-0000-0000-000000000001')$$,
  'admin required',
  'staff caller is denied'
);
-- After failure: Hub rows stay draft, no invite created
select is(
  (select count(*)::int from business_profile
    where workspace_id='cccccccc-0000-0000-0000-000000000002' and status='draft'),
  1, 'after staff denial: business_profile still draft'
);
select is(
  (select count(*)::int from business_rules
    where workspace_id='cccccccc-0000-0000-0000-000000000002' and status='draft'),
  2, 'after staff denial: business_rules still draft'
);
select is(
  (select count(*)::int from org_people
    where workspace_id='cccccccc-0000-0000-0000-000000000002' and status='draft'),
  1, 'after staff denial: org_people still draft'
);
select is(
  (select count(*)::int from workspace_invites
    where workspace_id='cccccccc-0000-0000-0000-000000000002'),
  0, 'after staff denial: no invite created'
);

-- ─── Negative test 2: incomplete steps ───────────────────────────────────────

set local "request.jwt.claims" =
  '{"sub":"dddddddd-0000-0000-0000-0000000000d1","email":"owner-d@test.dev","role":"authenticated"}';

select throws_ok(
  $$select complete_onboarding('dddddddd-0000-0000-0000-000000000001')$$,
  'onboarding steps incomplete',
  'incomplete steps throws'
);
select is(
  (select count(*)::int from business_profile
    where workspace_id='dddddddd-0000-0000-0000-000000000002' and status='draft'),
  1, 'after incomplete steps: business_profile still draft'
);
select is(
  (select count(*)::int from business_rules
    where workspace_id='dddddddd-0000-0000-0000-000000000002' and status='draft'),
  0, 'after incomplete steps: business_rules still draft'
);
select is(
  (select count(*)::int from org_people
    where workspace_id='dddddddd-0000-0000-0000-000000000002' and status='draft'),
  0, 'after incomplete steps: org_people still draft'
);
select is(
  (select count(*)::int from workspace_invites
    where workspace_id='dddddddd-0000-0000-0000-000000000002'),
  0, 'after incomplete steps: no invite created'
);

-- ─── Negative test 3: divergent rules ────────────────────────────────────────
-- Rules are draft; complete_onboarding activates them then the relocated guard
-- fires, rolling back ALL mutations (activation, profile, org_people, session).

set local "request.jwt.claims" =
  '{"sub":"eeeeeeee-0000-0000-0000-0000000000e1","email":"owner-e@test.dev","role":"authenticated"}';

select throws_ok(
  $$select complete_onboarding('eeeeeeee-0000-0000-0000-000000000001')$$,
  'divergent rules must be resolved',
  'divergent rules throws'
);
-- Full rollback: activations must be undone
select is(
  (select count(*)::int from business_rules
    where workspace_id='eeeeeeee-0000-0000-0000-000000000002' and status='active'),
  0, 'after divergent rules: 0 rules active (rolled back)'
);
select is(
  (select count(*)::int from business_rules
    where workspace_id='eeeeeeee-0000-0000-0000-000000000002' and status='draft'),
  2, 'after divergent rules: 2 rules still draft (rolled back)'
);
select is(
  (select count(*)::int from business_profile
    where workspace_id='eeeeeeee-0000-0000-0000-000000000002' and status='draft'),
  1, 'after divergent rules: business_profile still draft (rolled back)'
);
select is(
  (select count(*)::int from org_people
    where workspace_id='eeeeeeee-0000-0000-0000-000000000002' and status='draft'),
  1, 'after divergent rules: org_people still draft (rolled back)'
);
select is(
  (select status::text from onboarding_sessions
    where id='eeeeeeee-0000-0000-0000-000000000001'),
  'in_progress', 'after divergent rules: session not completed (rolled back)'
);
select is(
  (select count(*)::int from workspace_invites
    where workspace_id='eeeeeeee-0000-0000-0000-000000000002'),
  0, 'after divergent rules: no invite created'
);

-- ─── Happy-path: owner completes onboarding ──────────────────────────────────

set local "request.jwt.claims" =
  '{"sub":"cccccccc-0000-0000-0000-0000000000c1","email":"owner-c@test.dev","role":"authenticated"}';

select lives_ok(
  $$select complete_onboarding('cccccccc-0000-0000-0000-000000000001')$$,
  'owner completes onboarding'
);

-- business_profile activated
select is(
  (select status::text from business_profile
    where workspace_id='cccccccc-0000-0000-0000-000000000002'),
  'active',
  'business_profile is now active'
);

-- both business_rules activated
select is(
  (select count(*)::int from business_rules
    where workspace_id='cccccccc-0000-0000-0000-000000000002' and status='active'),
  2,
  'two business_rules now active'
);

-- org_people activated
select is(
  (select count(*)::int from org_people
    where workspace_id='cccccccc-0000-0000-0000-000000000002' and status='active'),
  1,
  'one org_people now active'
);

-- compliance_obligations remain draft (left untouched)
select is(
  (select count(*)::int from compliance_obligations
    where workspace_id='cccccccc-0000-0000-0000-000000000002' and status='draft'),
  1,
  'compliance_obligations remain draft'
);

-- one workspace_invite created
select is(
  (select count(*)::int from workspace_invites
    where workspace_id='cccccccc-0000-0000-0000-000000000002'),
  1,
  'one workspace_invite created'
);

-- onboarding feature enabled (exactly one enabled feature row)
select is(
  (select count(*)::int from workspace_features
    where workspace_id='cccccccc-0000-0000-0000-000000000002' and enabled),
  1,
  'onboarding feature enabled'
);

-- ─── Idempotency: second call succeeds and creates no extra invite ────────────

select lives_ok(
  $$select complete_onboarding('cccccccc-0000-0000-0000-000000000001')$$,
  'repeat completion is idempotent'
);

select is(
  (select count(*)::int from workspace_invites
    where workspace_id='cccccccc-0000-0000-0000-000000000002'),
  1,
  'idempotent second call: still exactly one invite'
);

select * from finish();
rollback;
