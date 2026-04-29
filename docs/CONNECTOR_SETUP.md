# Connector setup — developer credentials checklist

The desktop app ships scaffolded client code for five new connectors
(Trello, Todoist, Asana, Airtable, Google Sheets). Before any of them
can actually complete an OAuth handshake, you must register a developer
app on each platform and store the resulting credentials as Supabase
Edge Function secrets.

The pattern mirrors the existing **Notion** connector — see
`src/lib/startNotionOAuth.ts` and the `notion-oauth` Edge Function.

For each connector below, fill in the placeholders, deploy the matching
Edge Function, and the "Connect <platform>" button on the Platforms
page will start working.

---

## Common redirect URI

Every Edge Function callback URL has the same shape:

```
https://YOUR_SUPABASE_PROJECT_REF.supabase.co/functions/v1/FN_NAME/callback
```

Register **exactly** this URL on the platform’s developer portal — no
trailing slash, no `www`. Use the same **Reference ID** as in your project
**URL** (Supabase → Project Settings → General → Reference ID). Do **not**
paste angle brackets or words like `YOUR_SUPABASE_PROJECT_REF` into
Airtable or Google — only the real id. Replace `FN_NAME` with the Edge
Function name from each section below.

After the callback completes, the Edge Function redirects the browser
to `datavault://dashboard`, which the Electron main process forwards to
the app via the `deep-link` IPC channel
(`electron/main.ts` → `DeepLinkHandler` in `src/App.tsx`).

---

## 1. Trello

- **Edge Function name:** `trello-oauth`
- **Developer portal:** https://trello.com/power-ups/admin/
  - Create a new Power-Up (or classic integration) to get the API key.
- **Auth model:** OAuth 1.0a (token + secret); or use an API key + user
  token issued from https://trello.com/1/authorize.
- **Scopes to request on the authorize URL:**
  - `scope=read,write,account`
  - `expiration=never` (DataVault keeps the backup running)
- **Supabase secrets:**
  - `TRELLO_API_KEY`
  - `TRELLO_API_SECRET`
- **Rate limit:** 300 requests / 10 s per API key, 100 / 10 s per token.
  Chunk Trello sync in `run-sync` to stay under that ceiling.

## 2. Todoist

- **Edge Function name:** `todoist-oauth`
- **Developer portal:** https://developer.todoist.com/appconsole.html
- **Auth model:** OAuth2 authorization code.
- **Authorize URL:** `https://todoist.com/oauth/authorize`
- **Scopes:** `data:read_write` (covers backup + write-back).
- **Supabase secrets:**
  - `TODOIST_CLIENT_ID`
  - `TODOIST_CLIENT_SECRET`
- **Rate limit:** 1000 requests / 15 min per user.

## 3. Asana

- **Edge Function name:** `asana-oauth`
- **Developer portal:** https://app.asana.com/0/my-apps
- **Auth model:** OAuth2 authorization code (PKCE recommended).
- **Authorize URL:** `https://app.asana.com/-/oauth_authorize`
- **Scopes:** default (gives read + write on the user's workspaces).
- **Supabase secrets:**
  - `ASANA_CLIENT_ID`
  - `ASANA_CLIENT_SECRET`
- **Rate limit:** 150 requests / min for free accounts, 1500 / min for paid.

## 4. Airtable

- **Edge Function name:** `airtable-oauth`
- **Developer portal:** https://airtable.com/create/oauth
- **Auth model:** OAuth2 authorization code + PKCE (**required**).
- **Authorize URL:** `https://airtable.com/oauth2/v1/authorize`
- **Scopes:**
  - `data.records:read`
  - `data.records:write`
  - `schema.bases:read`
  - `user.email:read` (optional — for per-user labelling)
- **Supabase secrets:**
  - `AIRTABLE_CLIENT_ID`
  - `AIRTABLE_CLIENT_SECRET` (only if the app type is "confidential"; omit for PKCE-only public clients)
  - `OAUTH_STATE_SECRET` (optional — if unset, the Edge Function signs PKCE `state` with `SERVICE_ROLE_KEY`)
- **Rate limit:** 5 requests / sec per base. Sync each base serially.

## 5. Google Sheets

- **Edge Function name:** `google-sheets-oauth`
- **Developer portal:** https://console.cloud.google.com/apis/credentials
  - Create an OAuth 2.0 Client ID of type **Web application**.
  - You may also need to verify the app in OAuth consent screen if you
    intend to ship to external users.
- **Auth model:** OAuth2 authorization code + offline access (for refresh tokens).
- **Authorize URL:** `https://accounts.google.com/o/oauth2/v2/auth`
  - Include `access_type=offline` and `prompt=consent` so the callback
    returns a `refresh_token` on first connect.
- **Scopes:**
  - `https://www.googleapis.com/auth/spreadsheets` (read + write Sheets)
  - `https://www.googleapis.com/auth/drive.readonly` (list user's spreadsheets)
  - `https://www.googleapis.com/auth/userinfo.email` (so the connector row can show the Google account email)
- **Supabase secrets:**
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
- **Rate limit:** Sheets API — 300 read + 300 write / min / project.
  Drive API — 20 000 / 100 s / project.

---

## Database tables the Edge Functions will populate

The scaffolded data hooks (`src/hooks/use<Platform>Data.ts`) read from
these tables. Create them in Supabase with RLS scoped by
`auth.uid()` (follow the existing `notion_pages` / `notion_databases`
policy as the template):

| Platform | Tables (minimum) |
|---|---|
| Trello | `trello_boards`, `trello_lists`, `trello_cards`, `trello_checklists`, `trello_attachments` |
| Todoist | `todoist_projects`, `todoist_sections`, `todoist_tasks`, `todoist_labels`, `todoist_comments` |
| Asana | `asana_workspaces`, `asana_projects`, `asana_tasks`, `asana_subtasks` |
| Airtable | `airtable_bases`, `airtable_tables`, `airtable_records` |
| Google Sheets | `google_spreadsheets`, `google_sheets`, `google_cells` (or `google_sheet_ranges`) |

Each row **must** carry the `connector_id` foreign key so RLS and
per-workspace filtering work.

---

## Front-matter for write-back

Every `.md` or `.csv` file the Edge Functions export to Supabase
Storage must begin with a YAML front-matter block containing:

```yaml
---
platform: trello      # or notion, todoist, asana, airtable, google-sheets
connector_id: <uuid>
entity_id: <platform-specific-id>
version: <etag-or-last-edited-timestamp>
last_synced_at: <ISO 8601>
---
```

The `push-sync` Edge Function reads this block to route the update to
the correct platform and detect stale-edit conflicts (matches
`expectedVersion` in `src/lib/pushToSource.ts`).

---

## Verification after setup (per platform)

1. Deploy the `<kind>-oauth` Edge Function with the secrets set.
2. In the desktop app, go to **Platforms** → **Connect \<Platform\>**.
3. Complete the consent screen in the browser; the app should focus
   itself and route back via the `datavault://` deep link.
4. Open **Dashboard** — a new connector row appears.
5. Click **Start sync** → watch `run-sync` chunks in the network tab.
6. Open **Browse backup** → the synced files appear in the viewer.
7. Edit a file locally → click **Push to \<Platform\>** → confirm the
   change appears on the source platform.
