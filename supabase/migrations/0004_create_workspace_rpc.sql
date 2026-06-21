-- 0004_create_workspace_rpc.sql
create or replace function public.create_workspace(p_name text, p_slug text)
returns workspaces language plpgsql security definer
set search_path = public as $$
declare w workspaces;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;
  insert into workspaces(name, slug) values (p_name, p_slug) returning * into w;
  insert into workspace_members(workspace_id, user_id, role)
    values (w.id, auth.uid(), 'owner');
  return w;
end; $$;
