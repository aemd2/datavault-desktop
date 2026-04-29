-- Asana mirror tables (run-sync asanaSync.ts)

create table if not exists public.asana_projects (
  connector_id uuid not null references public.connectors (id) on delete cascade,
  id text not null,
  workspace_gid text not null default '',
  name text not null default '',
  notes text,
  archived boolean not null default false,
  modified_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (connector_id, id)
);

create table if not exists public.asana_tasks (
  connector_id uuid not null references public.connectors (id) on delete cascade,
  id text not null,
  project_gid text,
  name text not null default '',
  notes text,
  completed boolean not null default false,
  due_on date,
  modified_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (connector_id, id)
);

create index if not exists asana_tasks_project on public.asana_tasks (connector_id, project_gid);

alter table public.asana_projects enable row level security;
alter table public.asana_tasks enable row level security;

drop policy if exists asana_projects_all_own on public.asana_projects;
create policy asana_projects_all_own on public.asana_projects
  for all using (
    exists (
      select 1 from public.connectors c
      where c.id = asana_projects.connector_id and c.user_id = auth.uid()
    )
  );

drop policy if exists asana_tasks_all_own on public.asana_tasks;
create policy asana_tasks_all_own on public.asana_tasks
  for all using (
    exists (
      select 1 from public.connectors c
      where c.id = asana_tasks.connector_id and c.user_id = auth.uid()
    )
  );

comment on table public.asana_projects is 'Mirrored Asana projects per connector (run-sync).';
comment on table public.asana_tasks is 'Mirrored Asana tasks per connector (run-sync).';

-- Todoist mirror tables (run-sync todoistSync.ts)

create table if not exists public.todoist_projects (
  connector_id uuid not null references public.connectors (id) on delete cascade,
  id text not null,
  name text not null default '',
  color text,
  parent_id text,
  is_favorite boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (connector_id, id)
);

create table if not exists public.todoist_tasks (
  connector_id uuid not null references public.connectors (id) on delete cascade,
  id text not null,
  project_id text,
  content text not null default '',
  description text,
  priority integer not null default 1,
  due text,
  completed_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (connector_id, id)
);

create index if not exists todoist_tasks_project on public.todoist_tasks (connector_id, project_id);

alter table public.todoist_projects enable row level security;
alter table public.todoist_tasks enable row level security;

drop policy if exists todoist_projects_all_own on public.todoist_projects;
create policy todoist_projects_all_own on public.todoist_projects
  for all using (
    exists (
      select 1 from public.connectors c
      where c.id = todoist_projects.connector_id and c.user_id = auth.uid()
    )
  );

drop policy if exists todoist_tasks_all_own on public.todoist_tasks;
create policy todoist_tasks_all_own on public.todoist_tasks
  for all using (
    exists (
      select 1 from public.connectors c
      where c.id = todoist_tasks.connector_id and c.user_id = auth.uid()
    )
  );

comment on table public.todoist_projects is 'Mirrored Todoist projects per connector (run-sync).';
comment on table public.todoist_tasks is 'Mirrored Todoist tasks per connector (run-sync).';
