-- 0018_complaints_app_columns.sql
-- Add customer_id and notes columns used by the complaints service/store.
-- The migration 0015 used assignee_person_id / resolution_notes (domain model)
-- but the application store expects customer_id (generic customer ref) and notes (free text).
alter table complaints
  add column customer_id text,
  add column notes text;
