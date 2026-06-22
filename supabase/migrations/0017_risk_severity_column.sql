-- 0017_risk_severity_column.sql
-- Add computed severity column to risk_entries.
-- The application layer (severityBucket) computes and stores this value.
alter table risk_entries
  add column severity text not null default 'low'
    check (severity in ('low','med','high','ext'));
