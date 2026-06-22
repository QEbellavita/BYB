-- 0019_audit_triggers.sql — SH-3: Generalized data-change audit trigger
-- Attaches AFTER INSERT OR UPDATE OR DELETE on all 18 tenant tables.
-- Excluded (audit/derived infra): entity_versions, context_events, audit_log.
--
-- NOTE on tables with non-standard schemas:
--   workspaces        — has id but no workspace_id; we use id as workspace_id.
--   workspace_members — no id column (composite PK); entity_id stored as null.
--   workspace_features— no id column (composite PK); entity_id stored as null.
-- audit_log.workspace_id and .entity_id are both nullable, so this is correct.

create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rec        record;
  rec_json   jsonb;
  ws_id      uuid;
  ent_id     uuid;
begin
  -- Pick the live row (NEW for INSERT/UPDATE, OLD for DELETE)
  if TG_OP = 'DELETE' then rec := OLD; else rec := NEW; end if;
  rec_json := to_jsonb(rec);

  -- workspace_id: most tables have it; workspaces table uses its own id instead.
  -- Cast will yield NULL if the key is missing (jsonb ->> returns null for absent keys).
  ws_id  := (rec_json ->> 'workspace_id')::uuid;
  if ws_id is null then
    ws_id := (rec_json ->> 'id')::uuid;  -- fallback for workspaces table
  end if;

  -- entity_id: tables with composite PKs (workspace_members, workspace_features)
  -- have no 'id' column; stored as null.
  ent_id := (rec_json ->> 'id')::uuid;

  insert into audit_log(workspace_id, actor, action, entity_type, entity_id, before, after)
  values (
    ws_id,
    auth.uid(),
    lower(TG_OP),
    TG_TABLE_NAME,
    ent_id,
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(OLD) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) else null end
  );

  return null; -- AFTER trigger; return value is ignored
end $$;

-- Attach the trigger to all 18 tenant tables (mirrors the do-$$ pattern from 0009).
-- Excluded: entity_versions, context_events, audit_log.
do $$
declare t text;
begin
  foreach t in array array[
    -- 8 Context Hub entities
    'business_profile', 'business_rules', 'compliance_obligations',
    'internal_processes', 'decision_logic', 'risk_frameworks',
    'governance', 'org_people',
    -- 3 SP-3 module tables
    'risk_entries', 'complaints', 'improvements',
    -- 4 workspace-core tables
    'workspaces', 'workspace_members', 'workspace_invites', 'workspace_features',
    -- 3 onboarding + linking
    'onboarding_sessions', 'onboarding_invite_drafts', 'context_links'
  ]
  loop
    execute format(
      'create trigger %1$s_audit
       after insert or update or delete on %1$s
       for each row execute function public.audit_row_change()',
      t
    );
  end loop;
end $$;
