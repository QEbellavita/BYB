-- 0011_onboarding_security.sql
-- Hardens membership and invite writes to owner/admin only,
-- and adds onboarding_sessions + onboarding_invite_drafts tables with RLS.

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

-- Replace the broad member-scoped write policy with admin-only writes
drop policy if exists wm_write on workspace_members;
create policy wm_admin_insert on workspace_members for insert
  with check (public.is_workspace_admin(workspace_id));
create policy wm_admin_update on workspace_members for update
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));
create policy wm_admin_delete on workspace_members for delete
  using (public.is_workspace_admin(workspace_id));

-- Replace the broad member-scoped invite policy with admin-only writes
-- plus an invitee-own pending-invite read
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

-- New enums for onboarding state
create type onboarding_status as enum ('in_progress','completing','completed');
create type onboarding_invite_status as enum ('queued','committed','sent','failed');

-- One onboarding session per workspace
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

-- Invite drafts queued during onboarding, linked to org_people
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

-- Only workspace admins (owner/admin) can manage onboarding
create policy onboarding_sessions_admin on onboarding_sessions for all
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));
create policy onboarding_invite_drafts_admin on onboarding_invite_drafts for all
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

-- Ensure authenticated users can call the workspace RPCs
grant execute on function public.create_workspace(text,text) to authenticated;
grant execute on function public.redeem_invite(text) to authenticated;
