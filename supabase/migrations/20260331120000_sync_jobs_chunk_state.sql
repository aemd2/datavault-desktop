-- Add chunk_state column for time-boxed chunked sync support.
-- Stores continuation cursor and counts between Edge Function invocations.
ALTER TABLE public.sync_jobs ADD COLUMN IF NOT EXISTS chunk_state jsonb;
