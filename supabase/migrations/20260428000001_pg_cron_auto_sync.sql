-- Hourly cron that fires the `auto-sync-tick` Edge Function.
--
-- The function uses the service-role key (stored in Supabase Vault) to find
-- connectors with auto_backup_enabled=true whose last_synced_at is older than
-- 7 days, and triggers `run-sync` for each.
--
-- DEPLOYMENT (one-time per project, NOT in this migration):
--   1) In SQL Editor, store the service-role key in Vault:
--        select vault.create_secret(
--          '<paste service_role_key>',          -- secret value
--          'service_role_key',                  -- name
--          'Used by pg_cron auto-sync-hourly'   -- description
--        );
--   2) In SQL Editor, store the project URL the same way:
--        select vault.create_secret(
--          'https://<project-ref>.supabase.co',
--          'project_url',
--          'Base URL for self-invoked Edge Functions'
--        );
--   3) Re-run this migration (idempotent — uses cron.unschedule then schedule).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop the old job if it exists, then re-schedule.
do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'auto-sync-hourly';
  if jid is not null then
    perform cron.unschedule(jid);
  end if;
end$$;

-- Run at the top of every hour. The tick function itself decides which
-- connectors are actually due (last_synced_at < now() - 7 days).
select cron.schedule(
  'auto-sync-hourly',
  '0 * * * *',
  $cron$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/auto-sync-tick',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type',  'application/json'
      ),
      body    := '{}'::jsonb
    );
  $cron$
);
