# SP-2 Onboarding Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build BYB's resumable owner/admin onboarding wizard, creating the first workspace and writing Profile, Rules, Industry/Obligations, and People/RBAC into the Context Hub before an atomic Finish.

**Architecture:** The React guided workspace autosaves canonical business context as Context Hub drafts. The onboarding module stores only workflow progress and queued invitation intent. A single security-definer Postgres completion RPC activates profile/rules/people, leaves obligations draft, creates secure invitations, keeps the onboarding feature enabled, and completes the session atomically; email delivery happens only after commit. Future feature modules add their own enablement when they are registered.

**Tech Stack:** Node 20+, Express 4, TypeScript strict/ESM, React 18, Vite, Supabase Postgres/Auth/RLS, Vitest, Testing Library, Supertest, pgTAP.

## Global Constraints

- BYB is standalone. Do not add Quantara, Neural Workflow, biometric, ML, or multifractal dependencies.
- Business context is read/written only through the typed Context Hub boundary.
- Every tenant table has RLS and passing pgTAP cross-tenant isolation tests.
- RLS-sensitive server queries use a user JWT via `userScopedClient`.
- Workspace onboarding writes require owner/admin; staff must be denied at API and database layers.
- Save each valid step as a resumable draft; activate profile/rules/people only on Finish.
- Placeholder obligations remain draft and display: “General setup guidance only—not legal advice. Verify each obligation before activation.”
- Invitation records and emails are created only by Finish; tokens use `encode(gen_random_bytes(32), 'base64')`.
- Email sends only after the completion transaction commits.
- TypeScript local imports use `.js` extensions.
- Use test-first red/green/refactor for every behavior change.
- Use conventional commits on `sp-2-onboarding`; never commit implementation directly to `main`.

## File Structure

### Database

- `supabase/migrations/0011_onboarding_security.sql` — admin helper, membership/invite policy hardening, onboarding tables.
- `supabase/migrations/0012_complete_onboarding.sql` — atomic, idempotent completion RPC.
- `supabase/tests/onboarding_isolation_test.sql` — cross-tenant and role authorization.
- `supabase/tests/onboarding_completion_test.sql` — activation, rollback, invitation, idempotency.

### Server

- `server/src/context/onboarding.ts` — typed completion port and Supabase RPC adapter.
- `server/src/modules/onboarding/types.ts` — module DTOs and store interfaces.
- `server/src/modules/onboarding/validation.ts` — pure step validation and normalization.
- `server/src/modules/onboarding/anzsic-catalogue.ts` — deliberately small selector catalogue and advisory suggestions.
- `server/src/modules/onboarding/service.ts` — Hub draft orchestration and post-commit invitation delivery.
- `server/src/modules/onboarding/routes.ts` — authenticated entry route and owner/admin workspace routes.
- `server/src/modules/onboarding/manifest.ts` — first real feature manifest.
- `server/src/middleware/require-workspace-admin.ts` — API owner/admin gate.
- Modify `server/src/modules/types.ts`, `loader.ts`, `app.ts` — entry-path gate exemption and production wiring.
- `server/test/onboarding/*.test.ts` — validation, service, routes, manifest/loader behavior.
- Modify `server/test/integration/round-trip.test.ts` — teardown.
- `server/test/integration/onboarding.test.ts` — live complete flow.

### Web

- `web/src/onboarding/types.ts`, `api.ts`, `validation.ts` — browser contracts.
- `web/src/onboarding/OnboardingWizard.tsx`, `OnboardingRail.tsx` — state machine and guided layout.
- `web/src/onboarding/steps/*.tsx` — five focused stages.
- `web/src/onboarding/rule-builder/RuleEditor.tsx` — no-code rules.
- `web/src/onboarding/anzsic/AnzsicSelector.tsx` — searchable catalogue.
- Modify `web/src/api.ts`, `App.tsx`, `Shell.tsx`, `Login.tsx` — workspace headers, app gate, and assigned UX fixes.
- `web/test/onboarding/*.test.tsx` plus updated login/shell tests.

---

### Task 1: Harden Membership and Add Onboarding Persistence

**Files:**
- Create: `supabase/migrations/0011_onboarding_security.sql`
- Create: `supabase/tests/onboarding_isolation_test.sql`

**Interfaces:**
- Produces: `public.is_workspace_admin(uuid)`, `onboarding_sessions`, `onboarding_invite_drafts`.
- Produces: owner/admin-only membership and onboarding writes; invitee-own pending-invite reads.
- Consumed by: Tasks 2–8.

- [ ] **Step 1: Write the failing pgTAP authorization/isolation test**

Create fixtures for two users/workspaces and assert:

```sql
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
select is(
  (with changed as (
    update workspace_members set role='admin'
    where workspace_id='aaaaaaaa-0000-0000-0000-000000000001'
      and user_id='00000000-0000-0000-0000-0000000000a2'
    returning 1
  ) select count(*)::int from changed),
  0, 'staff cannot promote membership'
);
select is(
  (with changed as (
    update onboarding_sessions set current_step='rules'
    where workspace_id='aaaaaaaa-0000-0000-0000-000000000001'
    returning 1
  ) select count(*)::int from changed),
  0, 'staff cannot update onboarding'
);
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
```

- [ ] **Step 2: Run the database test and verify RED**

Run:

```bash
npm run db:reset
supabase test db supabase/tests/onboarding_isolation_test.sql
```

Expected: FAIL because onboarding tables and `is_workspace_admin` do not exist.

- [ ] **Step 3: Add the security migration**

Implement:

```sql
create or replace function public.is_workspace_admin(ws uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from workspace_members m
    where m.workspace_id = ws
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  );
$$;

drop policy if exists wm_write on workspace_members;
create policy wm_admin_insert on workspace_members for insert
  with check (public.is_workspace_admin(workspace_id));
create policy wm_admin_update on workspace_members for update
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));
create policy wm_admin_delete on workspace_members for delete
  using (public.is_workspace_admin(workspace_id));

drop policy if exists invites_rw on workspace_invites;
create policy invites_admin_write on workspace_invites for all
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));
create policy invites_own_pending_read on workspace_invites for select
  using (
    accepted_at is null and
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
create unique index workspace_invites_pending_email_uniq
  on workspace_invites (workspace_id, lower(email))
  where accepted_at is null;

create type onboarding_status as enum ('in_progress','completing','completed');
create type onboarding_invite_status as enum ('queued','committed','sent','failed');

create table onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references workspaces(id) on delete cascade,
  status onboarding_status not null default 'in_progress',
  current_step text not null default 'profile'
    check (current_step in ('profile','rules','industry','people','review')),
  completed_steps jsonb not null default '[]'::jsonb
    check (jsonb_typeof(completed_steps) = 'array'),
  started_by uuid not null references auth.users(id),
  completed_by uuid references auth.users(id),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table onboarding_invite_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  session_id uuid not null references onboarding_sessions(id) on delete cascade,
  org_person_id uuid not null references org_people(id) on delete cascade,
  email text not null,
  role member_role not null,
  access_scope jsonb not null default '{}'::jsonb,
  status onboarding_invite_status not null default 'queued',
  invite_id uuid references workspace_invites(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id, org_person_id),
  unique(session_id, email)
);

alter table onboarding_sessions enable row level security;
alter table onboarding_invite_drafts enable row level security;
create policy onboarding_sessions_admin on onboarding_sessions for all
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));
create policy onboarding_invite_drafts_admin on onboarding_invite_drafts for all
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

grant execute on function public.create_workspace(text,text) to authenticated;
grant execute on function public.redeem_invite(text) to authenticated;
```

- [ ] **Step 4: Run the test and full DB gate**

Run:

```bash
npm run db:reset
npm run db:test
```

Expected: all pgTAP tests PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0011_onboarding_security.sql supabase/tests/onboarding_isolation_test.sql
git commit -m "feat: secure onboarding persistence and membership writes"
```

---

### Task 2: Add Atomic, Idempotent Completion

**Files:**
- Create: `supabase/migrations/0012_complete_onboarding.sql`
- Create: `supabase/tests/onboarding_completion_test.sql`

**Interfaces:**
- Produces: `public.complete_onboarding(p_session_id uuid) returns jsonb`.
- Returns: `{session_id, workspace_id, invite_ids: [{id,email,token}], completed_at}`.
- Consumed by: Task 3.

- [ ] **Step 1: Write failing completion tests**

Cover these exact outcomes:

```sql
select lives_ok(
  $$select complete_onboarding(
    'cccccccc-0000-0000-0000-000000000001'
  )$$,
  'owner completes onboarding'
);
select is((select status::text from business_profile where workspace_id='cccccccc-0000-0000-0000-000000000002'), 'active');
select is((select count(*)::int from business_rules where workspace_id='cccccccc-0000-0000-0000-000000000002' and status='active'), 2);
select is((select count(*)::int from org_people where workspace_id='cccccccc-0000-0000-0000-000000000002' and status='active'), 1);
select is((select count(*)::int from compliance_obligations where workspace_id='cccccccc-0000-0000-0000-000000000002' and status='draft'), 1);
select is((select count(*)::int from workspace_invites where workspace_id='cccccccc-0000-0000-0000-000000000002'), 1);
select is((select count(*)::int from workspace_features where workspace_id='cccccccc-0000-0000-0000-000000000002' and enabled), 1);
select lives_ok(
  $$select complete_onboarding(
    'cccccccc-0000-0000-0000-000000000001'
  )$$,
  'repeat completion is idempotent'
);
select is((select count(*)::int from workspace_invites where workspace_id='cccccccc-0000-0000-0000-000000000002'), 1);
```

Also add negative tests for staff callers, incomplete steps, and divergent rules; after each
failure assert that all Hub rows remain draft and no invite exists.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
supabase test db supabase/tests/onboarding_completion_test.sql
```

Expected: FAIL because `complete_onboarding` does not exist.

- [ ] **Step 3: Implement the completion RPC**

Implement a `security definer set search_path = public` PL/pgSQL function which:

```sql
create or replace function public.complete_onboarding(
  p_session_id uuid
) returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  s onboarding_sessions;
  invite_row onboarding_invite_drafts;
  created_invite workspace_invites;
  invite_json jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'must be authenticated'; end if;

  select * into s from onboarding_sessions where id=p_session_id for update;
  if s.id is null then raise exception 'onboarding session not found'; end if;
  if not public.is_workspace_admin(s.workspace_id) then raise exception 'admin required'; end if;
  if s.status='completed' then
    return jsonb_build_object(
      'session_id', s.id, 'workspace_id', s.workspace_id,
      'invite_ids', '[]'::jsonb, 'completed_at', s.completed_at
    );
  end if;
  if s.completed_steps @> '["profile","rules","industry","people"]'::jsonb is not true then
    raise exception 'onboarding steps incomplete';
  end if;
  if exists(select 1 from public.context_rule_conflicts(s.workspace_id) where kind='divergent') then
    raise exception 'divergent rules must be resolved';
  end if;
  if (select count(*) from business_profile where workspace_id=s.workspace_id and status='draft') <> 1 then
    raise exception 'exactly one draft business profile required';
  end if;

  update onboarding_sessions set status='completing', updated_at=now() where id=s.id;
  update business_profile set status='archived'
    where workspace_id=s.workspace_id and status='active';
  update business_profile set status='active'
    where workspace_id=s.workspace_id and status='draft';
  update business_rules set status='active' where workspace_id=s.workspace_id and status='draft';
  update org_people set status='active' where workspace_id=s.workspace_id and status='draft';

  for invite_row in
    select * from onboarding_invite_drafts
    where session_id=s.id and status='queued' order by created_at
  loop
    insert into workspace_invites(workspace_id,email,role,token,invited_by)
    values (
      s.workspace_id, lower(invite_row.email), invite_row.role,
      encode(gen_random_bytes(32),'base64'), auth.uid()
    )
    returning * into created_invite;
    update onboarding_invite_drafts
      set status='committed', invite_id=created_invite.id, updated_at=now()
      where id=invite_row.id;
    invite_json := invite_json || jsonb_build_array(jsonb_build_object(
      'id', created_invite.id, 'email', created_invite.email, 'token', created_invite.token
    ));
  end loop;

  insert into workspace_features(workspace_id,module_id,enabled,enabled_at)
  values (s.workspace_id, 'onboarding', true, now())
  on conflict(workspace_id,module_id) do update set enabled=true, enabled_at=excluded.enabled_at;

  update onboarding_sessions set
    status='completed', current_step='review', completed_by=auth.uid(),
    completed_at=now(), updated_at=now()
  where id=s.id returning * into s;

  return jsonb_build_object(
    'session_id', s.id, 'workspace_id', s.workspace_id,
    'invite_ids', invite_json, 'completed_at', s.completed_at
  );
end $$;
grant execute on function public.complete_onboarding(uuid) to authenticated;
```

Keep obligations untouched. Rely on existing Hub triggers to version/audit/emit activation updates.

- [ ] **Step 4: Run completion and full DB tests**

Run:

```bash
npm run db:reset
npm run db:test
```

Expected: all tests PASS, including rollback and idempotency assertions.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0012_complete_onboarding.sql supabase/tests/onboarding_completion_test.sql
git commit -m "feat: atomically complete onboarding"
```

---

### Task 3: Add Typed Onboarding Domain, Validation, and Context Completion Port

**Files:**
- Create: `server/src/context/onboarding.ts`
- Modify: `server/src/context/index.ts`
- Create: `server/src/modules/onboarding/types.ts`
- Create: `server/src/modules/onboarding/validation.ts`
- Create: `server/src/modules/onboarding/anzsic-catalogue.ts`
- Test: `server/test/onboarding/validation.test.ts`
- Test: `server/test/context/onboarding.test.ts`

**Interfaces:**
- Produces: `CompletionStore.complete(sessionId)`.
- Produces: `validateProfile`, `validateRules`, `validateIndustry`, `validatePeople`.
- Produces: `ANZSIC_OPTIONS`, `obligationSuggestionsFor(code)`.
- Consumed by: Tasks 4, 6, 7.

- [ ] **Step 1: Write failing pure-domain tests**

Use table tests to prove:

```ts
expect(validateProfile({ name: '  Acme  ', jurisdiction: 'AU', size: 'small', description: '' }))
  .toEqual({ ok: true, value: { name: 'Acme', jurisdiction: 'AU', size: 'small', description: '' } })
expect(validateIndustry({ anzsicCode: '7000' }).ok).toBe(true)
expect(validateIndustry({ anzsicCode: '9999' })).toEqual({
  ok: false, errors: { anzsicCode: 'Select a supported ANZSIC code' },
})
expect(validatePeople([
  { personName: 'A', email: 'SAME@test.dev', role: 'staff', title: '', responsibilities: [], accessScope: {}, invite: true },
  { personName: 'B', email: 'same@test.dev', role: 'manager', title: '', responsibilities: [], accessScope: {}, invite: true },
]).ok).toBe(false)
expect(obligationSuggestionsFor('7000').every(x => x.status === 'draft')).toBe(true)
```

Test `supabaseOnboardingCompletionStore(db).complete('s1',['onboarding'])` calls:

```ts
db.rpc('complete_onboarding', { p_session_id: 's1' })
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npm run test:server -- --run test/onboarding/validation.test.ts test/context/onboarding.test.ts
```

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement types and validation**

Define:

```ts
export type OnboardingStep = 'profile'|'rules'|'industry'|'people'|'review'
export type PlatformRole = 'owner'|'admin'|'manager'|'compliance_officer'|'accountant'|'staff'
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Record<string,string> }
export interface ProfileInput { name:string; jurisdiction:'AU'|'NZ'; size:string; description:string }
export interface RuleInput {
  id?:string; version?:number; ruleType:'business_rule'|'value_setting'|'must_do'; area:string;
  statement:string; operator:string|null; value:unknown; consequence:string; appliesTo:string[]
}
export interface PersonInput {
  id?:string; version?:number; personName:string; title:string; email:string; responsibilities:string[];
  role:PlatformRole; accessScope:Record<string,unknown>; invite:boolean
}
```

Validation must trim text, lowercase emails, reject duplicate emails case-insensitively, require
operator/value together, and accept only identifiers in the submitted people/role set.

Export a fixed selector catalogue including:

```ts
export const ANZSIC_OPTIONS = [
  { code:'7000', label:'Computer System Design and Related Services' },
  { code:'6932', label:'Accounting Services' },
  { code:'6962', label:'Management Advice and Related Consulting Services' },
  { code:'4279', label:'Other Store-Based Retailing n.e.c.' },
  { code:'4511', label:'Cafes and Restaurants' },
  { code:'8601', label:'Aged Care Residential Services' },
] as const
```

Suggestions are generic operational prompts only, use `source:'custom'`, `status:'draft'`,
`subscribe_updates:false`, and include the exact disclaimer in their description.

- [ ] **Step 4: Implement the Context completion adapter**

Define:

```ts
export interface CompletionResult {
  session_id:string; workspace_id:string
  invite_ids:{id:string;email:string;token:string}[]
  completed_at:string
}
export interface CompletionStore {
  complete(sessionId:string):Promise<CompletionResult>
}
export function supabaseOnboardingCompletionStore(db:SupabaseClient):CompletionStore
```

Throw `complete onboarding: ${error.message}` on RPC failure. Export it as
`ContextHub.onboarding.complete` through a small injected-store wrapper.

- [ ] **Step 5: Run tests and build**

Run:

```bash
npm run test:server -- --run test/onboarding/validation.test.ts test/context/onboarding.test.ts
npm run build --workspace server
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/context server/src/modules/onboarding server/test/context/onboarding.test.ts server/test/onboarding/validation.test.ts
git commit -m "feat: define onboarding domain and completion port"
```

---

### Task 4: Build the Onboarding Service with Hub-Only Draft Writes

**Files:**
- Create: `server/src/modules/onboarding/service.ts`
- Test: `server/test/onboarding/service.test.ts`

**Interfaces:**
- Consumes: `HubStore`, `CompletionStore`, `EmailTransport`, validators.
- Produces: `createOnboardingService(deps)` with `load`, `saveProfile`, `saveRules`, `saveIndustry`, `savePeople`, `finish`, `retryInvitation`.
- Consumed by: Task 5.

- [ ] **Step 1: Write failing orchestration tests**

Use in-memory fake stores and assert:

```ts
await service.saveProfile(ctx, input)
expect(hubCalls).toEqual([['upsert','business_profile',{
  workspace_id:'w1', status:'draft', name:'Acme', jurisdiction:'AU', size:'small', description:''
}]])
expect(sessionCalls).toContainEqual(['completeStep','s1','profile','rules'])
```

Rules reconciliation must update submitted IDs, insert new drafts, and archive omitted onboarding
draft IDs. Industry must update the existing profile and reconcile only obligations created by the
session. People must write `org_people` drafts and separate queued invite intents; it must not
insert `workspace_members` or `workspace_invites`.

For every update carrying `{id,version}`, load the current Hub row first. If its version differs,
throw `StaleDraftError(entity,id)` and perform no write. Route tests in Task 5 map this error to
HTTP `409` with `{error:'draft changed; reload and retry'}`.

Finish tests must prove:

```ts
const result = await service.finish(ctx)
expect(completion.complete).toHaveBeenCalledBefore(email.send)
expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to:'person@test.dev' }))
```

When `email.send` rejects, completion remains successful and the invite draft is marked `failed`.
Retry sends only a `committed|failed` invitation and marks it `sent`.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npm run test:server -- --run test/onboarding/service.test.ts
```

Expected: FAIL because `createOnboardingService` is missing.

- [ ] **Step 3: Implement focused store ports and service**

In `types.ts`, add:

```ts
export interface OnboardingStore {
  createSession(workspaceId:string,userId:string):Promise<OnboardingSession>
  getSession(workspaceId:string):Promise<OnboardingSession|null>
  updateProgress(sessionId:string, currentStep:OnboardingStep, completedSteps:OnboardingStep[]):Promise<OnboardingSession>
  listInviteDrafts(sessionId:string):Promise<InviteDraft[]>
  reconcileInviteDrafts(sessionId:string, workspaceId:string, rows:InviteDraftInput[]):Promise<InviteDraft[]>
  markInviteDelivery(id:string,status:'sent'|'failed'):Promise<void>
}
```

Implement the service with injected repositories:

```ts
export function createOnboardingService(deps:{
  hub: typeof ContextHub
  hubStore: HubStore
  onboardingStore: OnboardingStore
  completionStore: CompletionStore
  sendInvite:(invite:{email:string;token:string;workspaceId:string})=>Promise<void>
}): OnboardingService
```

Define `OnboardingService` explicitly:

```ts
export interface OnboardingService {
  load(ctx:OnboardingContext):Promise<OnboardingSnapshot>
  saveProfile(ctx:OnboardingContext,input:unknown):Promise<OnboardingSnapshot>
  saveRules(ctx:OnboardingContext,input:unknown):Promise<OnboardingSnapshot>
  saveIndustry(ctx:OnboardingContext,input:unknown):Promise<OnboardingSnapshot>
  savePeople(ctx:OnboardingContext,input:unknown):Promise<OnboardingSnapshot>
  finish(ctx:OnboardingContext):Promise<FinishResult>
  retryInvitation(ctx:OnboardingContext,inviteDraftId:string):Promise<void>
}
```

Each method must be a named local async function returned by `createOnboardingService`; do not put
the whole service in one anonymous object literal. `finish` validates persisted state again, calls
completion exactly once, then loops over returned invite IDs and sends. It catches delivery errors
per invite and records failure without rejecting the completed onboarding result.

- [ ] **Step 4: Run tests**

Run:

```bash
npm run test:server -- --run test/onboarding/service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/onboarding/types.ts server/src/modules/onboarding/service.ts server/test/onboarding/service.test.ts
git commit -m "feat: orchestrate onboarding drafts through Context Hub"
```

---

### Task 5: Add Owner/Admin Routes, Feature Manifest, and Loader Wiring

**Files:**
- Create: `server/src/middleware/require-workspace-admin.ts`
- Create: `server/src/modules/onboarding/routes.ts`
- Create: `server/src/modules/onboarding/manifest.ts`
- Modify: `server/src/modules/types.ts`
- Modify: `server/src/modules/loader.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/onboarding/routes.test.ts`
- Modify: `server/test/loader.test.ts`

**Interfaces:**
- Produces authenticated `POST /api/m/onboarding/workspace`.
- Produces authenticated `GET /api/onboarding/bootstrap` returning the user's workspaces and each
  workspace's onboarding status.
- Produces owner/admin workspace routes from §6 of the spec.
- Produces manifest `id:'onboarding', defaultEnabled:true`.
- Consumed by: web Tasks 6–8.

- [ ] **Step 1: Write failing middleware/route/loader tests**

Assert:

```ts
expect(await request(app).put('/api/m/onboarding/profile').send(valid).set(staffHeaders)).toMatchObject({status:403})
expect(await request(app).put('/api/m/onboarding/profile').send(valid).set(ownerHeaders)).toMatchObject({status:200})
expect(await request(app).post('/api/m/onboarding/workspace').send({name:'Acme'}).set(authHeader)).toMatchObject({status:201})
expect(await request(app).get('/api/onboarding/bootstrap').set(authHeader)).toMatchObject({
  status:200,
  body:{workspaces:expect.any(Array)},
})
```

Loader tests must prove `POST /workspace` is feature-gate exempt, while `/session` reads the
`x-workspace-id` header before route middleware sets `req.workspaceId`.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npm run test:server -- --run test/onboarding/routes.test.ts test/loader.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement admin middleware and manifest metadata**

```ts
export function requireWorkspaceAdmin():RequestHandler {
  return (req,res,next) => {
    if (!req.member) return res.status(403).json({error:'no workspace context'})
    if (req.member.role !== 'owner' && req.member.role !== 'admin')
      return res.status(403).json({error:'owner or admin required'})
    next()
  }
}
```

Extend `ModuleManifest`:

```ts
gateExempt?: {method:string;path:string}[]
```

In `registerModules`, skip the feature gate only on an exact method/path match. Otherwise derive
workspace ID from `req.workspaceId ?? req.header('x-workspace-id')`, derive the bearer token from
the authorization header, and call:

```ts
isEnabled(workspaceId:string,moduleId:string,accessToken:string):Promise<boolean>
```

- [ ] **Step 4: Implement routes and production stores**

The bootstrap route runs `requireAuth` only and queries visible `workspaces`, left-joining
`workspace_members` and `onboarding_sessions` through the user's JWT-scoped client. It returns:

```ts
interface BootstrapResult {
  workspaces:{
    id:string; name:string; role:string
    onboardingStatus:'not_started'|'in_progress'|'completed'
  }[]
}
```

The workspace route runs `requireAuth` only, normalizes a slug, calls `create_workspace`, inserts
`workspace_features(workspace_id,'onboarding',true,now())`, and creates the session.

Every other route uses:

```ts
...authedWorkspaceRoute({ auth, workspace }),
requireWorkspaceAdmin()
```

then calls the matching service method and returns `400` for validation, `409` for stale/conflict,
and `500` only for unexpected errors.

Wire the onboarding manifest in `createApp(config)` using Supabase-backed Hub, completion,
onboarding, membership, auth, and feature-registry stores. Use the existing email service for
post-commit invitation delivery.

- [ ] **Step 5: Run tests and build**

Run:

```bash
npm run test:server -- --run test/onboarding/routes.test.ts test/loader.test.ts
npm run build --workspace server
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/middleware/require-workspace-admin.ts server/src/modules server/src/app.ts server/test
git commit -m "feat: expose onboarding as a gated feature module"
```

---

### Task 6: Add Browser API Contracts and App Onboarding Gate

**Files:**
- Modify: `web/src/api.ts`
- Create: `web/src/onboarding/types.ts`
- Create: `web/src/onboarding/api.ts`
- Create: `web/src/onboarding/validation.ts`
- Modify: `web/src/App.tsx`
- Test: `web/test/onboarding/app-gate.test.tsx`
- Test: `web/test/onboarding/api.test.ts`

**Interfaces:**
- Produces: `onboardingApi(token, workspaceId?)`.
- Produces: App state `auth-loading | signed-out | onboarding | ready`.
- Consumed by: Tasks 7–8.

- [ ] **Step 1: Write failing API/app-gate tests**

Assert API calls include:

```ts
expect(fetch).toHaveBeenCalledWith(
  'http://api.test/api/m/onboarding/session',
  expect.objectContaining({headers:expect.objectContaining({
    Authorization:'Bearer token', 'x-workspace-id':'w1',
  })}),
)
```

App gate cases:

- session loading renders “Loading BYB”.
- signed-out renders Login.
- authenticated user with no workspace renders workspace/Profile onboarding.
- incomplete session renders the server's `current_step`.
- completed session renders Shell.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npm run test:web -- --run test/onboarding/api.test.ts test/onboarding/app-gate.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement typed API**

Change `apiFetch` to:

```ts
export async function apiFetch<T>(
  path:string, token:string,
  options:{method?:string;workspaceId?:string;body?:unknown}={}
):Promise<T>
```

Set JSON content type only when a body exists; include `x-workspace-id` when supplied; parse error
JSON and throw `ApiError(status, body)`.

Export:

```ts
export function onboardingApi(token:string, workspaceId?:string) {
  return {
    bootstrap:()=>apiFetch<BootstrapResult>('/api/onboarding/bootstrap',token),
    createWorkspace:(name:string)=>apiFetch<CreateWorkspaceResult>('/api/m/onboarding/workspace',token,{method:'POST',body:{name}}),
    load:()=>apiFetch<OnboardingSnapshot>('/api/m/onboarding/session',token,{workspaceId}),
    saveProfile:(body:ProfileInput)=>apiFetch<OnboardingSnapshot>('/api/m/onboarding/profile',token,{method:'PUT',workspaceId,body}),
    saveRules:(body:RuleInput[])=>apiFetch<OnboardingSnapshot>('/api/m/onboarding/rules',token,{method:'PUT',workspaceId,body}),
    saveIndustry:(body:IndustryInput)=>apiFetch<OnboardingSnapshot>('/api/m/onboarding/industry',token,{method:'PUT',workspaceId,body}),
    savePeople:(body:PersonInput[])=>apiFetch<OnboardingSnapshot>('/api/m/onboarding/people',token,{method:'PUT',workspaceId,body}),
    finish:()=>apiFetch<FinishResult>('/api/m/onboarding/finish',token,{method:'POST',workspaceId}),
  }
}
```

- [ ] **Step 4: Implement App state gate**

Stabilize callbacks with `useCallback`. Fetch `/api/me` plus `GET /api/onboarding/bootstrap`.
Hold the chosen workspace ID in React state and `localStorage` key `byb.workspaceId`.
Render `OnboardingWizard` until the session is complete.

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test:web -- --run test/onboarding/api.test.ts test/onboarding/app-gate.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/api.ts web/src/App.tsx web/src/onboarding web/test/onboarding
git commit -m "feat: gate the web app through onboarding"
```

---

### Task 7: Build the Guided Wizard, Profile, and Rules Steps

**Files:**
- Create: `web/src/onboarding/OnboardingWizard.tsx`
- Create: `web/src/onboarding/OnboardingRail.tsx`
- Create: `web/src/onboarding/steps/ProfileStep.tsx`
- Create: `web/src/onboarding/steps/RulesStep.tsx`
- Create: `web/src/onboarding/rule-builder/RuleEditor.tsx`
- Create: `web/src/onboarding/onboarding.css`
- Test: `web/test/onboarding/wizard.test.tsx`
- Test: `web/test/onboarding/rules.test.tsx`

**Interfaces:**
- Consumes `OnboardingSnapshot` and `onboardingApi`.
- Produces resumable rail, autosave state, Profile and Rules UI.
- Consumed by: Task 8.

- [ ] **Step 1: Write failing wizard and rules tests**

Test:

```tsx
render(<OnboardingWizard api={fakeApi} initial={snapshot({currentStep:'rules'})} />)
expect(screen.getByRole('navigation',{name:/onboarding progress/i})).toBeInTheDocument()
expect(screen.getByRole('heading',{name:/how does your business operate/i})).toBeInTheDocument()
```

Assert users cannot click People when Profile is incomplete, can revisit Profile after completion,
see `Saving…` then `Saved`, retain values on a rejected save, add/edit/archive a rule, and see an
advisory divergent-conflict warning.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npm run test:web -- --run test/onboarding/wizard.test.tsx test/onboarding/rules.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement the guided workspace shell**

Use semantic buttons and forms. `OnboardingRail` receives:

```ts
{currentStep:OnboardingStep; completedSteps:OnboardingStep[]; onSelect(step):void}
```

Disable forward steps until all preceding required steps are complete. CSS uses a two-column rail
at `min-width: 760px` and a horizontal scrollable stepper below it. Display autosave state in an
`aria-live="polite"` region.

- [ ] **Step 4: Implement Profile and Rule Builder**

Profile creates the first workspace when none exists; afterward it updates the Hub draft. Rule
Editor renders type, area, statement, operator/value, consequence, and applies-to controls.
Archiving removes a rule from the visible draft list and submits reconciliation on save.

Warnings are advisory:

```tsx
<aside role="status">
  Divergent rule: this statement has a different value or consequence for the same audience.
</aside>
```

Do not add a bypass around Finish blocking; the server remains authoritative.

- [ ] **Step 5: Run tests and web build**

Run:

```bash
npm run test:web -- --run test/onboarding/wizard.test.tsx test/onboarding/rules.test.tsx
npm run build --workspace web
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/onboarding web/test/onboarding
git commit -m "feat: add guided profile and rule onboarding"
```

---

### Task 8: Add Industry, People, Review, and Finish

**Files:**
- Create: `web/src/onboarding/steps/IndustryStep.tsx`
- Create: `web/src/onboarding/anzsic/AnzsicSelector.tsx`
- Create: `web/src/onboarding/steps/PeopleStep.tsx`
- Create: `web/src/onboarding/steps/ReviewStep.tsx`
- Modify: `web/src/onboarding/OnboardingWizard.tsx`
- Test: `web/test/onboarding/industry.test.tsx`
- Test: `web/test/onboarding/people-review.test.tsx`

**Interfaces:**
- Completes all five wizard stages and Finish.

- [ ] **Step 1: Write failing UI tests**

Assert:

- search “computer” selects `7000 — Computer System Design and Related Services`;
- the exact legal disclaimer is visible before selecting suggestions;
- selected obligations are labelled `Draft — verification required`;
- duplicate emails are rejected case-insensitively;
- invites say “Invitation sends when you finish setup”;
- Review separates “Activates now”, “Remains draft”, and “Emails after completion”;
- failed Finish leaves the Review screen and all draft data intact;
- successful Finish calls `onComplete`.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npm run test:web -- --run test/onboarding/industry.test.tsx test/onboarding/people-review.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement Industry**

Filter the server-supplied catalogue by code/label. Suggestions use checkboxes and editable name/
description fields. Always render:

```tsx
<p role="note">
  General setup guidance only—not legal advice. Verify each obligation before activation.
</p>
```

- [ ] **Step 4: Implement People and Review**

People rows include name, title, email, responsibilities, role, access scope, and invite toggle.
Prevent removing/demoting the current owner entry. Review renders normalized persisted data, not
unsaved local drafts.

Finish requires a checkbox:

```tsx
<label>
  <input
    type="checkbox"
    checked={confirmed}
    onChange={(event) => setConfirmed(event.currentTarget.checked)}
  />
  I have reviewed this setup and understand suggested obligations remain drafts.
</label>
```

Disable Finish until checked and no unresolved divergent conflicts exist.

- [ ] **Step 5: Run tests and build**

Run:

```bash
npm run test:web -- --run test/onboarding/industry.test.tsx test/onboarding/people-review.test.tsx
npm run build --workspace web
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/onboarding web/test/onboarding
git commit -m "feat: complete industry people and review onboarding"
```

---

### Task 9: Finish Assigned Auth UX and Live Integration Coverage

**Files:**
- Modify: `web/src/Login.tsx`
- Modify: `web/src/Shell.tsx`
- Modify: `web/test/login.test.tsx`
- Modify: `web/test/shell.test.tsx`
- Modify: `server/test/integration/round-trip.test.ts`
- Create: `server/test/integration/onboarding.test.ts`
- Modify: `server/package.json`

**Interfaces:**
- Produces reliable auth transition UX and clean live-stack tests.

- [ ] **Step 1: Write failing Login/Shell tests**

Assert Login disables the button and displays `Sending…`, then shows an OTP error. Assert Shell
shows `Loading your workspace…` before success and `Could not load your account` on failure.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npm run test:web -- --run test/login.test.tsx test/shell.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement UX states**

Use `loading` and `error` state; catch rejected promises; use `aria-live` for errors; restore the
submit button after failure. Keep copy literal to the tests.

- [ ] **Step 4: Add live onboarding integration test first**

Create a user, sign in, call workspace creation, save four steps, call Finish, then assert:

```ts
expect(profile.status).toBe('active')
expect(rules.every(r => r.status === 'active')).toBe(true)
expect(people.every(p => p.status === 'active')).toBe(true)
expect(obligations.every(o => o.status === 'draft')).toBe(true)
expect(invites).toHaveLength(1)
expect(session.status).toBe('completed')
```

Add another tenant and prove it cannot select the first tenant's onboarding rows. Add `afterAll`
cleanup for users/workspaces in both integration files. Change `test:int` to:

```json
"test:int": "node --env-file=../.env ../node_modules/.bin/vitest run test/integration"
```

with no hardcoded individual test path.

- [ ] **Step 5: Run integration and whole-project verification**

Run:

```bash
npm run db:reset
npm run db:test
npm test
npm run build --workspace server
npm run build --workspace web
npm run test:int --workspace server
```

Expected: all commands PASS with zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/Login.tsx web/src/Shell.tsx web/test server/test/integration server/package.json
git commit -m "test: verify complete onboarding flow"
```

---

### Task 10: Final Scope and Security Verification

**Files:**
- Modify only files required by failures found in this task.

**Interfaces:**
- Produces a release-ready SP-2 branch.

- [ ] **Step 1: Run focused security searches**

Run:

```bash
rg -n "workspace_members|workspace_invites|business_profile|business_rules|compliance_obligations|org_people" server/src/modules/onboarding web/src/onboarding
rg -n "Quantara|Neural Workflow|multifractal|biometric" . --glob '!node_modules/**' --glob '!.superpowers/**'
```

Expected:

- no client or route directly mutates membership/invites outside the approved service/RPC;
- no module-local copy of Hub business context;
- no Quantara coupling in SP-2 files.

- [ ] **Step 2: Verify migration and RLS inventory**

Run:

```bash
rg -n "create table onboarding_|enable row level security|create policy" supabase/migrations/0011_onboarding_security.sql
```

Expected: both onboarding tables have RLS and owner/admin policies.

- [ ] **Step 3: Run the complete verification matrix again**

Run:

```bash
npm run db:reset
npm run db:test
npm test
npm run build --workspace server
npm run build --workspace web
npm run test:int --workspace server
git diff --check main...HEAD
git status --short
```

Expected: all PASS; clean worktree.

- [ ] **Step 4: Review changed scope**

Run the repository-required GitNexus change detection before any final commit or merge. Confirm all
modified symbols and execution flows belong to SP-2. Resolve any unexpected HIGH/CRITICAL impact
before proceeding.

- [ ] **Step 5: Handle verification findings**

If verification changes a file, return to the task that owns that file, rerun that task's focused
red/green test, and amend that task's commit. If no files change, create no commit.
