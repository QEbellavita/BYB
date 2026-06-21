-- 0013_api_role_grants.sql — explicit privileges for the PostgREST API roles.
--
-- We do NOT rely on Supabase's implicit default-privilege grants. Those are
-- applied by some Supabase CLI versions but not others: they existed on the dev
-- machine (so the app and superuser psql worked) yet were ABSENT on the CI
-- runner, where the pgTAP RLS gate failed with "permission denied for table
-- workspaces" under `set role authenticated`. A fresh Supabase Cloud project
-- would hit the same gap in production. Granting explicitly makes it
-- deterministic across CLI versions, CI, and Cloud.
--
-- These are TABLE-LEVEL ACLs, evaluated BEFORE row-level security. RLS still
-- gates every row — every table in this schema has RLS enabled with policies —
-- so broad table grants here do not widen row access; without them, authenticated
-- (user-JWT) queries are denied outright before RLS is ever consulted.

grant usage on schema public to anon, authenticated, service_role;

-- Table data access: authenticated (user JWT) + service_role. anon needs no
-- table access (it is used only for the auth endpoints), so it is omitted.
grant select, insert, update, delete on all tables in schema public
  to authenticated, service_role;
grant usage, select on all sequences in schema public
  to authenticated, service_role;

-- Future objects created in this schema inherit the same grants, so later
-- migrations don't silently reintroduce the gap.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;
