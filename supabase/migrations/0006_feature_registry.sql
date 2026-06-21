-- 0006_feature_registry.sql
create table workspace_features (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  module_id text not null,
  enabled boolean not null default false,
  enabled_at timestamptz,
  primary key (workspace_id, module_id)
);
alter table workspace_features enable row level security;
create policy features_rw on workspace_features for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
