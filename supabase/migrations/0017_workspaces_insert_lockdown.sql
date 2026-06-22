-- 0017_workspaces_insert_lockdown.sql
-- SH-2.1 H1: close the workspaces direct-insert hole.
-- ws_insert (0002) used `with check (true)`, and 0013 grants INSERT to authenticated,
-- which together let any authenticated user POST /rest/v1/workspaces directly,
-- bypassing the create_workspace RPC (orphan rows / slug-squatting). Workspaces must
-- only be created via the SECURITY DEFINER create_workspace() function (runs as owner),
-- so revoke the direct table grant and drop the permissive insert policy.
drop policy if exists ws_insert on public.workspaces;
revoke insert on public.workspaces from authenticated;
