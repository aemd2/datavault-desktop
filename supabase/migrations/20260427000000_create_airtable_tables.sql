-- Airtable mirror tables (run-sync airtableSync.ts)

create table if not exists public.airtable_bases (
  connector_id uuid not null references public.connectors (id) on delete cascade,
  id text not null,
  name text not null default '',
  permission_level text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (connector_id, id)
);

create table if not exists public.airtable_tables (
  connector_id uuid not null references public.connectors (id) on delete cascade,
  id text not null,
  base_id text not null,
  name text not null default '',
  fields_json jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (connector_id, id)
);

create index if not exists airtable_tables_base on public.airtable_tables (connector_id, base_id);

create table if not exists public.airtable_records (
  connector_id uuid not null references public.connectors (id) on delete cascade,
  id text not null,
  base_id text not null,
  table_id text not null,
  fields_json jsonb,
  created_time timestamptz,
  last_modified_time timestamptz,
  synced_at timestamptz not null default now(),
  primary key (connector_id, id)
);

create index if not exists airtable_records_table on public.airtable_records (connector_id, table_id);

alter table public.airtable_bases enable row level security;
alter table public.airtable_tables enable row level security;
alter table public.airtable_records enable row level security;

drop policy if exists airtable_bases_all_own on public.airtable_bases;
create policy airtable_bases_all_own on public.airtable_bases
  for all using (
    exists (
      select 1 from public.connectors c
      where c.id = airtable_bases.connector_id and c.user_id = auth.uid()
    )
  );

drop policy if exists airtable_tables_all_own on public.airtable_tables;
create policy airtable_tables_all_own on public.airtable_tables
  for all using (
    exists (
      select 1 from public.connectors c
      where c.id = airtable_tables.connector_id and c.user_id = auth.uid()
    )
  );

drop policy if exists airtable_records_all_own on public.airtable_records;
create policy airtable_records_all_own on public.airtable_records
  for all using (
    exists (
      select 1 from public.connectors c
      where c.id = airtable_records.connector_id and c.user_id = auth.uid()
    )
  );

comment on table public.airtable_bases is 'Mirrored Airtable bases per connector.';
comment on table public.airtable_tables is 'Mirrored Airtable tables per connector.';
comment on table public.airtable_records is 'Mirrored Airtable records per connector.';

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';
