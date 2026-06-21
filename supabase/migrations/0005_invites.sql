-- 0005_invites.sql
create table workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text not null,
  role member_role not null default 'staff',
  token text unique not null,
  invited_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index on workspace_invites (workspace_id);

alter table workspace_invites enable row level security;
-- members of a workspace manage its invites
create policy invites_rw on workspace_invites for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- redeem runs as the invitee; security definer so it can read the invite + insert membership.
-- SECURITY: redemption is bound to the invited email — the caller's auth email must match
-- the invite's email, so a leaked token cannot be redeemed by an unintended account.
-- NOTE: invite tokens MUST be generated with a CSPRNG of sufficient entropy by the
-- invite-CREATION flow (built in the People/onboarding sub-project), e.g.
-- encode(gen_random_bytes(32),'base64'), so tokens cannot be enumerated.
create or replace function public.redeem_invite(p_token text)
returns workspaces language plpgsql security definer
set search_path = public as $$
declare inv workspace_invites; w workspaces; u_email text;
begin
  if auth.uid() is null then raise exception 'must be authenticated'; end if;
  select email into u_email from auth.users where id = auth.uid();
  select * into inv from workspace_invites where token = p_token and accepted_at is null;
  if inv.id is null then raise exception 'invalid or used invite'; end if;
  if lower(inv.email) <> lower(coalesce(u_email, '')) then
    raise exception 'invite is for a different email';
  end if;
  insert into workspace_members(workspace_id, user_id, role)
    values (inv.workspace_id, auth.uid(), inv.role)
    on conflict (workspace_id, user_id) do update set role = excluded.role;
  update workspace_invites set accepted_at = now() where id = inv.id;
  select * into w from workspaces where id = inv.workspace_id;
  return w;
end; $$;
