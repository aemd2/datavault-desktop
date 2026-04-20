-- Trello mirror tables (mirrors remote apply_migration create_trello_mirror_tables)

create table if not exists public.trello_boards (
  connector_id uuid not null references public.connectors (id) on delete cascade,
  id text not null,
  name text not null default '',
  "desc" text,
  url text,
  closed boolean not null default false,
  last_activity_date timestamptz,
  raw_json jsonb,
  primary key (connector_id, id)
);

create table if not exists public.trello_lists (
  connector_id uuid not null references public.connectors (id) on delete cascade,
  id text not null,
  board_id text not null,
  name text not null default '',
  closed boolean not null default false,
  pos text,
  raw_json jsonb,
  primary key (connector_id, id)
);

create table if not exists public.trello_cards (
  connector_id uuid not null references public.connectors (id) on delete cascade,
  id text not null,
  board_id text not null,
  list_id text,
  name text not null default '',
  "desc" text,
  due timestamptz,
  closed boolean not null default false,
  last_activity_date timestamptz,
  raw_json jsonb,
  primary key (connector_id, id)
);

create index if not exists trello_lists_board on public.trello_lists (connector_id, board_id);
create index if not exists trello_cards_board on public.trello_cards (connector_id, board_id);
create index if not exists trello_cards_list on public.trello_cards (connector_id, list_id);

alter table public.trello_boards enable row level security;
alter table public.trello_lists enable row level security;
alter table public.trello_cards enable row level security;

drop policy if exists trello_boards_all_own on public.trello_boards;
create policy trello_boards_all_own on public.trello_boards
  for all using (
    exists (
      select 1 from public.connectors c
      where c.id = trello_boards.connector_id and c.user_id = auth.uid()
    )
  );

drop policy if exists trello_lists_all_own on public.trello_lists;
create policy trello_lists_all_own on public.trello_lists
  for all using (
    exists (
      select 1 from public.connectors c
      where c.id = trello_lists.connector_id and c.user_id = auth.uid()
    )
  );

drop policy if exists trello_cards_all_own on public.trello_cards;
create policy trello_cards_all_own on public.trello_cards
  for all using (
    exists (
      select 1 from public.connectors c
      where c.id = trello_cards.connector_id and c.user_id = auth.uid()
    )
  );

comment on table public.trello_boards is 'Mirrored Trello boards per connector (run-sync).';
comment on table public.trello_lists is 'Mirrored Trello lists per connector.';
comment on table public.trello_cards is 'Mirrored Trello cards per connector.';
