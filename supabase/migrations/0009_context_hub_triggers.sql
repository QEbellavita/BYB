-- 0009_context_hub_triggers.sql — DB-enforced versioning, audit, outbox
create or replace function public.hub_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    NEW.version := 1;
    if NEW.created_by is null then NEW.created_by := auth.uid(); end if;
    NEW.updated_by := auth.uid();
    NEW.created_at := coalesce(NEW.created_at, now());
    NEW.updated_at := now();
    if NEW.status = 'active' and NEW.approved_by is null then
      NEW.approved_by := auth.uid(); NEW.approved_at := now();
    end if;
  elsif TG_OP = 'UPDATE' then
    NEW.version := OLD.version + 1;
    NEW.updated_by := auth.uid();
    NEW.updated_at := now();
    if NEW.status = 'active' and OLD.status is distinct from 'active' then
      NEW.approved_by := auth.uid(); NEW.approved_at := now();
    end if;
  end if;
  return NEW;
end $$;

create or replace function public.hub_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into entity_versions(workspace_id, entity_type, entity_id, version, snapshot, status, actor)
    values (NEW.workspace_id, TG_TABLE_NAME, NEW.id, NEW.version, to_jsonb(NEW), NEW.status, auth.uid());
  insert into context_events(workspace_id, type, entity_type, entity_id, before, after, actor)
    values (NEW.workspace_id, TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME, NEW.id,
            case when TG_OP = 'UPDATE' then to_jsonb(OLD) else null end, to_jsonb(NEW), auth.uid());
  return NEW;
end $$;

do $$
declare t text;
begin
  foreach t in array array['business_profile','business_rules','compliance_obligations',
    'internal_processes','decision_logic','risk_frameworks','governance','org_people']
  loop
    execute format('create trigger %1$s_before before insert or update on %1$s
      for each row execute function public.hub_before_write()', t);
    execute format('create trigger %1$s_after after insert or update on %1$s
      for each row execute function public.hub_after_write()', t);
  end loop;
end $$;
