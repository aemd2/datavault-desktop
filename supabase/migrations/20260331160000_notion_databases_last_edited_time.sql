-- Add last_edited_time to notion_databases so the skip-if-unchanged
-- optimization works for databases too (not just pages and rows).
ALTER TABLE public.notion_databases
  ADD COLUMN IF NOT EXISTS last_edited_time timestamptz;
