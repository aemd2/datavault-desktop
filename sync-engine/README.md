# DataVault sync-engine (POC)

Python CLI that pulls your Notion workspace and upserts into Postgres (`notion_*` tables).

## Prerequisites

1. **Supabase** project with migrations applied through `003_notion_schema.sql` (run SQL in the Supabase SQL editor or use Supabase CLI).
2. **Notion** [internal integration](https://developers.notion.com/docs/create-a-notion-integration) with access to your workspace pages.
3. **Postgres connection string** from Supabase: **Settings → Database → URI** (use the direct connection with the database password). The `postgres` role bypasses RLS so the worker can write mirrored data.

## Create a `connectors` row (dev)

1. Sign up a user in Supabase Auth (e.g. magic link from the app `/login`).
2. In **Authentication → Users**, copy the user UUID.
3. Run in SQL editor (replace placeholders):

```sql
insert into public.connectors (user_id, type, access_token, workspace_name)
values (
  'YOUR_USER_UUID',
  'notion',
  'secret_YOUR_NOTION_INTEGRATION_TOKEN',
  'My workspace'
)
returning id;
```

4. Copy the returned `id` — this is **`CONNECTOR_ID`** for the CLI.

**Security:** Prefer storing tokens encrypted or via Vault in production. This POC uses plain `access_token` for simplicity.

## Environment

Copy `.env.example` to `.env` in this folder:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres URI (`postgresql://postgres.[ref]:[password]@...`) |
| `NOTION_TOKEN` | Same token as in `connectors.access_token` (integration secret) |
| `CONNECTOR_ID` | UUID from `insert into connectors ... returning id` |
| `SYNC_SINCE` | (Optional) RFC3339 timestamp for `sync --incremental` |

## Install & run

```bash
cd sync-engine
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -e ".[dev]"
python -m sync_engine sync
```

Incremental (best-effort; uses sorted search):

```bash
set SYNC_SINCE=2026-01-01T00:00:00.000Z
python -m sync_engine sync --incremental
```

## Docker

```bash
docker build -t datavault-sync .
docker run --env-file .env datavault-sync
```

## MIT

Open-source engine per product roadmap; enterprise connectors may live elsewhere.
