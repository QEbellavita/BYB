-- 0020_created_by_fks.sql
-- Add real FK constraints (references auth.users(id) on delete set null)
-- to the bare actor uuid columns on 11 tables:
--   8 Context Hub entities: created_by, updated_by, approved_by
--   3 SP-3 tables (risk_entries, complaints, improvements): created_by, updated_by
--
-- Idempotent: each constraint add is guarded by a pg_constraint existence check.
-- Orphans are nulled first so the constraint validates on existing data.

do $$
declare
  t       text;
  col     text;
  cname   text;
  hub_tables text[] := array[
    'business_profile','business_rules','compliance_obligations',
    'internal_processes','decision_logic','risk_frameworks',
    'governance','org_people'
  ];
  sp3_tables text[] := array[
    'risk_entries','complaints','improvements'
  ];
  hub_cols text[] := array['created_by','updated_by','approved_by'];
  sp3_cols text[] := array['created_by','updated_by'];
begin

  -- Hub entities: created_by, updated_by, approved_by
  foreach t in array hub_tables loop
    foreach col in array hub_cols loop
      cname := t || '_' || col || '_fkey';

      -- null any orphaned values so the constraint validates
      execute format(
        'update %I set %I = null where %I is not null and %I not in (select id from auth.users)',
        t, col, col, col
      );

      -- add constraint if not already present
      if not exists (
        select 1 from pg_constraint c
        join pg_class r on r.oid = c.conrelid
        join pg_namespace n on n.oid = r.relnamespace
        where n.nspname = 'public'
          and r.relname = t
          and c.conname = cname
      ) then
        execute format(
          'alter table %I add constraint %I foreign key (%I) references auth.users(id) on delete set null',
          t, cname, col
        );
      end if;

    end loop;
  end loop;

  -- SP-3 tables: created_by, updated_by only (no approved_by)
  foreach t in array sp3_tables loop
    foreach col in array sp3_cols loop
      cname := t || '_' || col || '_fkey';

      execute format(
        'update %I set %I = null where %I is not null and %I not in (select id from auth.users)',
        t, col, col, col
      );

      if not exists (
        select 1 from pg_constraint c
        join pg_class r on r.oid = c.conrelid
        join pg_namespace n on n.oid = r.relnamespace
        where n.nspname = 'public'
          and r.relname = t
          and c.conname = cname
      ) then
        execute format(
          'alter table %I add constraint %I foreign key (%I) references auth.users(id) on delete set null',
          t, cname, col
        );
      end if;

    end loop;
  end loop;

end $$;
