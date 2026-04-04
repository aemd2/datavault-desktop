-- Allow sync_jobs.status = 'cancelled' when the user stops a backup from the dashboard.
ALTER TABLE public.sync_jobs DROP CONSTRAINT IF EXISTS sync_jobs_status_check;
ALTER TABLE public.sync_jobs ADD CONSTRAINT sync_jobs_status_check CHECK (
  status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'failed'::text, 'cancelled'::text])
);
