-- 0010_context_rule_conflicts.sql — deterministic, advisory rule-conflict detection
create or replace function public.context_rule_conflicts(ws uuid)
returns table(rule_a uuid, rule_b uuid, kind text)
language sql stable security invoker set search_path = public as $$
  select a.id, b.id,
         case when a.value is not distinct from b.value
                   and a.consequence is not distinct from b.consequence
              then 'duplicate' else 'divergent' end
  from business_rules a
  join business_rules b
    on a.workspace_id = b.workspace_id
   and a.id < b.id
   and a.area = b.area
   and lower(btrim(a.statement)) = lower(btrim(b.statement))
  where a.workspace_id = ws
    and a.status = 'active' and b.status = 'active'
    and exists (
      select 1
      from jsonb_array_elements_text(a.applies_to) x
      join jsonb_array_elements_text(b.applies_to) y on x = y
    );
$$;
