-- Google Sheets mirror tables (run-sync googleSheetsSync.ts)

create table if not exists public.google_spreadsheets (
  connector_id uuid not null references public.connectors (id) on delete cascade,
  id text not null,                    -- internal PK (= drive_file_id)
  drive_file_id text not null,
  name text not null default '',
  last_modified_time timestamptz,
  web_view_link text,
  synced_at timestamptz not null default now(),
  primary key (connector_id, id)
);

create table if not exists public.google_sheets (
  connector_id uuid not null references public.connectors (id) on delete cascade,
  id text not null,                    -- "{spreadsheet_id}_{sheet_id}"
  spreadsheet_id text not null,
  sheet_id integer not null,
  title text not null default '',
  row_count integer,
  column_count integer,
  last_synced_at timestamptz,
  primary key (connector_id, id)
);

create index if not exists google_sheets_spreadsheet
  on public.google_sheets (connector_id, spreadsheet_id);

create table if not exists public.google_sheet_rows (
  connector_id uuid not null references public.connectors (id) on delete cascade,
  id text not null,                    -- "{spreadsheet_id}_{sheet_id}_{row_index}"
  spreadsheet_id text not null,
  sheet_id integer not null,
  row_index integer not null,
  values_json jsonb,
  synced_at timestamptz not null default now(),
  primary key (connector_id, id)
);

create index if not exists google_sheet_rows_sheet
  on public.google_sheet_rows (connector_id, spreadsheet_id, sheet_id);

alter table public.google_spreadsheets enable row level security;
alter table public.google_sheets enable row level security;
alter table public.google_sheet_rows enable row level security;

drop policy if exists google_spreadsheets_all_own on public.google_spreadsheets;
create policy google_spreadsheets_all_own on public.google_spreadsheets
  for all using (
    exists (
      select 1 from public.connectors c
      where c.id = google_spreadsheets.connector_id and c.user_id = auth.uid()
    )
  );

drop policy if exists google_sheets_all_own on public.google_sheets;
create policy google_sheets_all_own on public.google_sheets
  for all using (
    exists (
      select 1 from public.connectors c
      where c.id = google_sheets.connector_id and c.user_id = auth.uid()
    )
  );

drop policy if exists google_sheet_rows_all_own on public.google_sheet_rows;
create policy google_sheet_rows_all_own on public.google_sheet_rows
  for all using (
    exists (
      select 1 from public.connectors c
      where c.id = google_sheet_rows.connector_id and c.user_id = auth.uid()
    )
  );

comment on table public.google_spreadsheets is 'Mirrored Google Spreadsheets per connector.';
comment on table public.google_sheets is 'Mirrored sheets (tabs) per spreadsheet.';
comment on table public.google_sheet_rows is 'Mirrored row data per sheet.';

notify pgrst, 'reload schema';
