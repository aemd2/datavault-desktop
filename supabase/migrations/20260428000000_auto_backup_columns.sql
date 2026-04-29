-- Auto-backup feature: adds per-connector toggle + error tracking.
--
-- Context: today every backup is a manual "Sync Now" click. With these columns
-- the new `auto-sync-tick` Edge Function (called hourly by pg_cron) can find
-- connectors due for a weekly sync, kick off `run-sync`, and surface failures
-- on the dashboard via `auto_backup_last_error`.

alter table public.connectors
  add column if not exists auto_backup_enabled boolean not null default false,
  add column if not exists auto_backup_last_error text,
  add column if not exists auto_backup_last_attempt_at timestamptz;

-- Partial index: speeds up the hourly query that scans for due connectors.
-- Only enabled rows are indexed, so the index stays small.
create index if not exists connectors_auto_backup_due_idx
  on public.connectors (auto_backup_enabled, last_synced_at)
  where auto_backup_enabled = true;

-- Force PostgREST to reload its schema cache so the new columns are queryable
-- via supabase-js immediately after the migration applies.
notify pgrst, 'reload schema';
