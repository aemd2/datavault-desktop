-- Waitlist table: stores emails from the landing page.
-- Already applied via Supabase MCP (apply_migration) to project gfiugqsqfuphqvyxojtg.
-- To re-apply or run manually: Supabase SQL Editor → paste and run.

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

-- Optional: index for listing by signup date (e.g. in dashboard).
create index if not exists waitlist_created_at_idx on public.waitlist (created_at desc);

-- RLS: allow anyone to INSERT (sign up), but only you can read via dashboard/service role.
alter table public.waitlist enable row level security;

-- Anyone can insert (anon key used by the site).
create policy "Allow anonymous insert"
  on public.waitlist
  for insert
  to anon
  with check (true);

-- No public read: only service_role or authenticated (e.g. your admin) can select.
-- So the list is not scrapable from the app; you read it in Supabase dashboard or your backend.
create policy "No public read"
  on public.waitlist
  for select
  to anon
  using (false);

-- Only service_role can read (e.g. Supabase dashboard Table Editor). No public read.
-- Grant usage: anon can insert, service_role can do anything (bypasses RLS).
grant insert on public.waitlist to anon;
grant all on public.waitlist to service_role;
