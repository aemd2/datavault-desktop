# Supabase Edge Functions (DataVault)

| Function | Purpose |
|----------|---------|
| `notion-oauth` | Start Notion OAuth and exchange `code` → access token (finish DB upsert with service role). |
| `run-sync` | Chunked Notion → Postgres backup with smart skip-if-unchanged, orphan cleanup, and optional force mode (user JWT; uses connector token server-side). |
| `cancel-sync` | User stops a queued or running `sync_jobs` row (JWT + connector ownership check). |
| `stripe-webhook` | Stripe billing events for managed tiers. |
| `scheduled-sync` | Secured endpoint for cron to ping (trigger Python sync worker or queue). |

## Deploy

```bash
supabase login
supabase link --project-ref YOUR_REF
supabase functions deploy notion-oauth
supabase functions deploy stripe-webhook
supabase functions deploy scheduled-sync
supabase functions deploy run-sync
supabase functions deploy cancel-sync
```

Set secrets in **Supabase Dashboard → Edge Functions → Secrets**.

> **Rule:** Custom secret names must NOT start with `SUPABASE_` — the dashboard blocks it.  
> `SUPABASE_URL` is auto-injected at runtime. Do not add it manually.

### Required secrets

| Secret name | Where to get it |
|---|---|
| `NOTION_CLIENT_ID` | Notion → Services → DataVault integration |
| `NOTION_CLIENT_SECRET` | Notion → Services → DataVault integration → Show |
| `NOTION_REDIRECT_URI` | `https://gfiugqsqfuphqvyxojtg.supabase.co/functions/v1/notion-oauth` |
| `SERVICE_ROLE_KEY` | Supabase → Project Settings → API → **service_role** (secret, never in browser) |
| `FRONTEND_URL` | Your deployed app URL, e.g. `https://data-freedom-hub.vercel.app` |
| `CRON_SECRET` | Any random string — keep it private |

### Stripe secrets (add when you set up billing)

| Secret name | Where to get it |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API Keys → Secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Webhooks → your endpoint → Signing secret |
| `STRIPE_PRICE_MANAGED` | Stripe Dashboard → Products → Managed plan → Price ID |
| `STRIPE_PRICE_ENTERPRISE` | Stripe Dashboard → Products → Enterprise plan → Price ID |

## Cron

Use **Supabase Scheduled Functions** (Dashboard) or **pg_cron** + `pg_net` to `POST` `scheduled-sync` with header:

`Authorization: Bearer <CRON_SECRET>`

## Incremental / smart sync

The `run-sync` Edge Function now implements smart skip-if-unchanged:

- Compares `last_edited_time` from Notion against our DB before fetching blocks.
- Unchanged items are skipped (saves API calls and time).
- Archived items are deleted from our DB.
- After a full search, orphan cleanup deletes DB rows no longer in Notion.
- Pass `force: true` to bypass the optimization and re-copy everything.

The Python path (`python -m sync_engine sync --incremental`) uses `SYNC_SINCE` (see `sync-engine/README.md`) but is separate from the Edge Function flow.
