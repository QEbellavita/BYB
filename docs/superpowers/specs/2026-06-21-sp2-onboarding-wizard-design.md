# SP-2: Onboarding Wizard — Design Spec

- **Date:** 2026-06-21
- **Status:** Approved in brainstorming; pending written-spec review
- **Depends on:** SP-1 Context Hub, merged to `main`
- **Parent architecture:** `docs/superpowers/specs/2026-06-21-byb-platform-architecture-design.md`

## 1. Goal

Build BYB's first real feature module: an owner/admin-only onboarding wizard that creates a
workspace and defines its initial operating context. The wizard collects a Business Profile,
business rules, an ANZSIC industry selection with advisory placeholder obligations, and people,
responsibilities, and platform access.

The wizard writes business context only through the typed Context Hub. It is resumable, saves each
step as a draft, and exposes nothing as active until an explicit final review and Finish action.
Invitation emails are also deferred until Finish.

SP-2 is independent of Quantara. It has no Neural Workflow, biometric, ML, or multifractal
integration.

## 2. Decisions

| Area | Decision |
|---|---|
| Persistence | Save each completed step as resumable Context Hub drafts. |
| Activation | Business Profile, rules, and people activate together on Finish. |
| Invitations | Queue during People; create/send only after successful Finish. |
| Authorization | Only workspace owners and admins may create, resume, edit, or finish onboarding. |
| ANZSIC obligations | Editable draft suggestions with a clear “not legal advice—verify before activation” warning; never auto-activated. |
| Rules | Remain drafts until final review and Finish. |
| First workspace | SP-2 creates the user's first workspace, making the creator its owner. |
| Layout | Guided workspace: persistent left progress rail, focused step content, final Review stage. |

## 3. Scope

### In scope

- First-workspace creation and owner membership.
- A resumable onboarding session.
- Five UI stages: Profile, Rules, Industry, People, Review.
- Autosaving valid step data as Context Hub drafts.
- A no-code business Rule Builder.
- A small SP-2 ANZSIC selector catalogue.
- Clearly labelled placeholder obligation suggestions.
- Organisation people, responsibilities, platform roles, and access scopes.
- Queued invitations that send only after Finish.
- Atomic final activation and onboarding completion.
- People/membership security hardening deferred from SP-0.
- Login and shell UX fixes already assigned to SP-2.
- The onboarding feature manifest and app/module wiring.

### Deferred

- A complete or authoritative ANZSIC-to-obligations dataset (SP-7).
- Legal interpretation, monitoring, RAG, or AI-generated obligations.
- Per-person bespoke permission-editor UI beyond role plus explicit access scope.
- Non-admin editing of completed Context Hub data.
- Reopening onboarding after completion; later Context Hub management screens own subsequent edits.
- Realtime browser updates; SP-2 can use ordinary request/response autosave.

## 4. User experience

### 4.1 Entry

After OTP sign-in:

1. If the user has no workspace, the app starts first-workspace onboarding.
2. The Profile step collects the workspace/business name and creates the workspace through the
   existing `create_workspace()` RPC.
3. The app stores the selected workspace ID and opens or resumes its onboarding session.
4. If the user already has an incomplete owner/admin onboarding session, the app resumes the last
   valid step.
5. Completed onboarding enters the normal shell.

Existing workspaces without an onboarding session may start one only if the current member is an
owner or admin.

### 4.2 Guided workspace layout

A persistent left rail shows:

- Profile
- Rules
- Industry
- People
- Review

The rail indicates complete, current, and incomplete stages. Users may revisit completed steps.
They cannot jump forward past required invalid steps. The content pane contains one focused task,
an autosave state (`Saving`, `Saved`, `Could not save`), Back, and Save & Continue.

The layout must remain usable on narrow screens by collapsing the rail into a compact top stepper.

### 4.3 Profile

Fields:

- Business/workspace name
- Jurisdiction: AU or NZ
- Business size
- Description

Industry selection is completed in the Industry step, but the same draft `business_profile` row is
updated there with `anzsic_code` and `anzsic_label`.

### 4.4 Rule Builder

Users add, edit, reorder for presentation, and archive draft rules. Each rule captures:

- Type: business rule, value/setting, or must-do
- Area
- Plain-language statement
- Operator and structured value where applicable
- Consequence if not met
- Applies-to identifiers: roles and/or queued people

The UI surfaces deterministic Context Hub conflicts as advisory warnings. Duplicate/divergent
warnings do not block draft save, but unresolved divergent rules block Finish.

### 4.5 Industry and obligations

The bundled catalogue contains a deliberately limited set of valid ANZSIC codes and labels for UI
selection; it is not an obligations dataset. The user searches/selects a code from this catalogue.
Selecting a code:

- updates the draft Business Profile;
- displays a small set of generic, editable placeholder obligation suggestions;
- lets the user opt individual suggestions into the Hub as draft `compliance_obligations`.

Every suggestion and selected draft displays:

> General setup guidance only—not legal advice. Verify each obligation before activation.

SP-2 never activates these obligations. SP-7 replaces the placeholder catalogue with curated,
provenance-backed industry obligations.

### 4.6 People and RBAC

Each person entry contains:

- Name
- Title
- Email
- Responsibilities
- Platform role
- Access scope
- Invite/no-invite choice

Saving this step writes `org_people` drafts through the Context Hub and writes invitation intent to
the onboarding module only. No email, auth user, or membership is created yet.

The current owner cannot remove or demote themself during onboarding. Duplicate emails in the same
workspace are rejected.

### 4.7 Review and Finish

Review shows the exact profile, rules, draft obligations, people, roles, access scopes, and email
invitations involved. It distinguishes:

- items that will become active;
- obligations that will remain advisory drafts;
- invitations that will be created and sent after commit.

Finish requires an explicit confirmation. On success, the UI enters the completed shell. On
failure, it remains on Review with all drafts intact and no invitation emails sent.

## 5. Architecture and boundaries

### 5.1 React web

```
web/src/onboarding/
  OnboardingWizard.tsx
  OnboardingRail.tsx
  steps/
    ProfileStep.tsx
    RulesStep.tsx
    IndustryStep.tsx
    PeopleStep.tsx
    ReviewStep.tsx
  rule-builder/
  anzsic/
  onboarding-api.ts
  onboarding-types.ts
  validation.ts
```

The UI owns transient form state and retry UX. The server remains authoritative for persisted
drafts, completion status, roles, and validation.

### 5.2 Onboarding module

```
server/src/modules/onboarding/
  manifest.ts
  routes.ts
  service.ts
  validation.ts
  anzsic-catalogue.ts
  invitation-service.ts
  types.ts
```

The module:

- exposes authenticated, workspace-scoped, owner/admin-only routes;
- coordinates Context Hub repositories;
- stores onboarding progress and invitation intent;
- validates cross-step consistency;
- owns the Finish transaction boundary;
- creates invitations with cryptographically secure tokens;
- sends invitation email only after durable completion.

It does not duplicate profile, rules, obligations, or people into module tables.

SP-2 adds one typed transactional operation to the Context Hub boundary,
`ContextHub.onboarding.complete(...)`. The onboarding module calls this operation rather than
updating Hub tables directly. Its Supabase implementation invokes the database completion RPC
described in §7.

### 5.3 Context Hub

All business context uses existing typed repositories:

- `ContextHub.profile`
- `ContextHub.rules`
- `ContextHub.obligations`
- `ContextHub.people`

All intermediate rows use `status='draft'`. Finish activates Profile, rules, and people through the
Hub's write path so database versioning, audit snapshots, and outbox events remain authoritative.
Obligations remain draft.

### 5.4 Onboarding-owned persistence

New tenant tables:

#### `onboarding_sessions`

- `id`
- `workspace_id` (unique)
- `status`: `in_progress | completing | completed`
- `current_step`
- `completed_steps` JSON array
- `started_by`
- `completed_by`
- `started_at`, `updated_at`, `completed_at`

#### `onboarding_invite_drafts`

- `id`
- `workspace_id`
- `session_id`
- `org_person_id`
- `email`
- `role`
- `access_scope`
- `status`: `queued | committed | sent | failed`
- `invite_id` nullable
- timestamps

Both tables are workspace-scoped, have owner/admin-only read/write RLS policies, and receive pgTAP
cross-tenant and same-tenant-role authorization coverage. They store workflow state only, not
canonical business context.

## 6. API shape

Representative routes under `/api/m/onboarding`:

- `POST /workspace` — create the first workspace and onboarding session. The server derives a
  normalized slug from the submitted business name and appends a short random suffix on collision.
- `GET /session` — load progress, drafts, conflicts, and queued invitations.
- `PUT /profile` — validate and upsert the draft profile.
- `PUT /rules` — reconcile the workspace's onboarding draft rules.
- `PUT /industry` — validate ANZSIC selection, update profile, and reconcile selected draft obligations.
- `PUT /people` — reconcile draft people and queued invitation intents.
- `POST /finish` — validate and atomically complete onboarding.

Workspace-scoped routes use `authedWorkspaceRoute`, then an owner/admin authorization gate. The
first-workspace route is authenticated but cannot require an existing workspace; it calls the
security-definer workspace RPC and returns the new workspace ID.

All write responses return normalized server state so the browser replaces optimistic state with
the authoritative draft.

## 7. Atomic completion and invitation delivery

Finish performs these operations in one database transaction through a narrowly scoped
`complete_onboarding(session_id)` Postgres RPC, exposed to the module through
`ContextHub.onboarding.complete(...)`:

1. Lock the onboarding session.
2. Verify the caller is an owner/admin and the session is still `in_progress`.
3. Validate required steps and canonical Hub drafts.
4. Reject unresolved divergent business-rule conflicts.
5. Activate the Business Profile, rules, and people.
6. Leave compliance obligations as drafts.
7. Create `workspace_invites` records from queued invitation intents using a CSPRNG token.
8. Mark invite drafts `committed`.
9. Ensure every currently registered `defaultEnabled` module has an enabled
   `workspace_features` row. SP-2 does not pre-register future modules.
10. Mark the onboarding session `completed`.

The transaction commits before any email is sent. After commit, the service sends each committed
invitation and marks it `sent` or `failed`. A failed email does not roll back completed onboarding;
it is visible and retryable. The token and invite row already exist safely.

Repeated Finish calls are idempotent: a completed session returns its completed state and never
duplicates Hub activation, invites, or emails.

## 8. People and invitation security

SP-2 closes the relevant deferred SP-0 findings:

- Add `is_workspace_admin(workspace_id)` as `SECURITY DEFINER set search_path = public`, guarding
  `auth.uid()`.
- Replace the membership-scoped write policy with owner/admin-only insert/update/delete policies.
- Preserve membership reads for workspace members.
- Add pgTAP tests proving staff cannot mutate membership and owners/admins can.
- Generate invitation tokens inside the completion RPC with
  `encode(gen_random_bytes(32), 'base64')`; never accept a client-provided token.
- Keep redemption bound to the authenticated invited email.
- Add a pending-invite read policy restricted to the authenticated user's normalized auth email.
- Add a unique partial index for one unaccepted invitation per normalized email and workspace, so
  retries cannot create duplicate pending invitations.
- Add explicit authenticated execute grants for workspace/invite RPCs.

The server never returns raw invite tokens after invitation creation except where strictly needed
to construct the email link.

## 9. Validation and failure behavior

### Step validation

- Profile: non-empty trimmed name; valid jurisdiction and supported size.
- Rules: valid type, area, statement, operator/value pairing, consequence shape, known applies-to
  identifiers.
- Industry: ANZSIC code must exist in the bundled catalogue.
- People: valid unique email, supported role, non-empty name, valid access-scope shape.

### Failure behavior

- Autosave failure retains local edits, shows a non-destructive error, and offers retry.
- A stale/changed server version returns `409`; the UI reloads authoritative state before retry.
- Authorization failures return `403` without revealing workspace data.
- Finish validation returns structured per-step errors and does not activate anything.
- Database failure rolls back all activation and invitation creation.
- Post-commit email failure is recorded and retryable; it does not corrupt completion.
- A user who loses owner/admin permission while the wizard is open is blocked on the next write.

## 10. Existing UX fixes included

SP-2 also completes the small React items assigned from SP-0:

- Stabilize `App`'s `fetchMe` callback.
- Add a real loading/error state to `Shell`.
- Show OTP submission errors and loading state in `Login`.

These changes support a reliable transition into onboarding but do not broaden SP-2's domain scope.

## 11. Testing strategy

Implementation follows test-driven development.

### Web tests

- Guided rail navigation and narrow-screen stepper.
- Required-step gating and revisiting completed steps.
- Autosave states, retry, and resume from server progress.
- Rule add/edit/archive and conflict warnings.
- ANZSIC search/selection and mandatory legal disclaimer.
- People validation, queued-invite messaging, and no send before Finish.
- Review summary and Finish success/failure.
- Owner/admin access behavior.
- Login and shell loading/error improvements.

### Server unit and route tests

- Step validation and normalized payloads.
- Owner/admin-only authorization.
- Context Hub draft writes with no duplicated business context.
- Reconciliation semantics for edited/removed drafts.
- Finish orchestration, idempotency, and structured failures.
- Invitation email is never sent before commit.
- Post-commit send failure is recorded and retryable.
- Module manifest and feature gating.

### Database tests

- RLS isolation for both onboarding tables.
- Owner/admin membership-write policy and staff denial.
- CSPRNG-backed invite creation and email-bound redemption.
- Atomic `complete_onboarding`: success, rollback, repeated call, draft obligations retained.
- Context Hub version/audit/outbox rows are produced by activation.

### Integration smoke

A live-stack test signs in a user, creates a workspace, saves all wizard steps, finishes, and proves:

- profile/rules/people are active;
- obligations remain draft;
- onboarding is complete;
- one invite exists per queued person;
- no cross-tenant records are visible.

The test cleans up the created user/workspace in `afterAll`.

## 12. Non-goals

- No Quantara integration.
- No authoritative legal advice or full obligations library.
- No AI-generated onboarding content.
- No activation of suggested obligations.
- No general-purpose Context Hub management dashboard.
- No feature module copies of Hub business context.
- No invitation email before successful Finish.
