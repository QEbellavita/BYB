-- 0012_complete_onboarding.sql
-- Atomic, idempotent completion RPC for the onboarding wizard (SP-2).
-- Requires: auth + workspace admin, all four required steps completed,
-- exactly one draft business_profile; divergent-rule check runs AFTER
-- activation so that context_rule_conflicts sees the newly-active rules.
-- Activates: business_profile, business_rules, org_people.
-- Leaves: compliance_obligations in draft.
-- Creates: workspace_invites from queued onboarding_invite_drafts.
-- Enables: 'onboarding' workspace feature.
-- Idempotent: a second call on a completed session returns success immediately.

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

  select * into s from onboarding_sessions where id = p_session_id for update;
  if s.id is null then raise exception 'onboarding session not found'; end if;
  if not public.is_workspace_admin(s.workspace_id) then raise exception 'admin required'; end if;

  -- Idempotency: already completed → return early with no changes
  if s.status = 'completed' then
    return jsonb_build_object(
      'session_id',    s.id,
      'workspace_id',  s.workspace_id,
      'invite_ids',    '[]'::jsonb,
      'completed_at',  s.completed_at
    );
  end if;

  -- All four required onboarding steps must be present
  if s.completed_steps @> '["profile","rules","industry","people"]'::jsonb is not true then
    raise exception 'onboarding steps incomplete';
  end if;

  -- Exactly one draft business_profile must exist
  if (select count(*) from business_profile
      where workspace_id = s.workspace_id and status = 'draft') <> 1 then
    raise exception 'exactly one draft business profile required';
  end if;

  -- Mark session as completing (prevents concurrent double-submission)
  update onboarding_sessions
    set status = 'completing', updated_at = now()
    where id = s.id;

  -- Archive any current active business_profile first (partial-unique constraint safety)
  update business_profile
    set status = 'archived'
    where workspace_id = s.workspace_id and status = 'active';

  -- Activate the draft business_profile
  update business_profile
    set status = 'active'
    where workspace_id = s.workspace_id and status = 'draft';

  -- Activate all draft business_rules
  update business_rules
    set status = 'active'
    where workspace_id = s.workspace_id and status = 'draft';

  -- Activate all draft org_people
  update org_people
    set status = 'active'
    where workspace_id = s.workspace_id and status = 'draft';

  -- compliance_obligations are intentionally left in draft

  -- Divergent-rule check: runs AFTER activation so context_rule_conflicts sees
  -- the just-activated rules. Any divergence aborts the whole transaction,
  -- rolling back all activations atomically.
  if exists (
    select 1 from public.context_rule_conflicts(s.workspace_id) where kind = 'divergent'
  ) then
    raise exception 'divergent rules must be resolved';
  end if;

  -- Create workspace_invites from queued onboarding_invite_drafts
  for invite_row in
    select * from onboarding_invite_drafts
    where session_id = s.id and status = 'queued'
    order by created_at
  loop
    insert into workspace_invites(workspace_id, email, role, token, invited_by)
    values (
      s.workspace_id,
      lower(invite_row.email),
      invite_row.role,
      encode(extensions.gen_random_bytes(32), 'base64'),
      auth.uid()
    )
    returning * into created_invite;

    update onboarding_invite_drafts
      set status = 'committed', invite_id = created_invite.id, updated_at = now()
      where id = invite_row.id;

    invite_json := invite_json || jsonb_build_array(jsonb_build_object(
      'id',    created_invite.id,
      'email', created_invite.email,
      'token', created_invite.token
    ));
  end loop;

  -- Enable the 'onboarding' workspace feature
  insert into workspace_features(workspace_id, module_id, enabled, enabled_at)
  values (s.workspace_id, 'onboarding', true, now())
  on conflict (workspace_id, module_id)
    do update set enabled = true, enabled_at = excluded.enabled_at;

  -- Mark session as completed
  update onboarding_sessions set
    status       = 'completed',
    current_step = 'review',
    completed_by = auth.uid(),
    completed_at = now(),
    updated_at   = now()
  where id = s.id
  returning * into s;

  return jsonb_build_object(
    'session_id',   s.id,
    'workspace_id', s.workspace_id,
    'invite_ids',   invite_json,
    'completed_at', s.completed_at
  );
end;
$$;

grant execute on function public.complete_onboarding(uuid) to authenticated;
