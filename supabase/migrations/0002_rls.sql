-- 0002_rls.sql — membership-scoped RLS (ported from Cinder)
create or replace function public.is_workspace_member(ws uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

alter table workspaces        enable row level security;
alter table workspace_members enable row level security;

-- workspaces: a user sees workspaces they belong to
create policy ws_select on workspaces for select
  using (public.is_workspace_member(id));
-- creation is handled by the create_workspace() RPC (0004), which also adds membership
create policy ws_insert on workspaces for insert with check (true);

-- membership rows are visible/writable to members of that workspace
create policy wm_select on workspace_members for select
  using (public.is_workspace_member(workspace_id));
create policy wm_write on workspace_members for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
