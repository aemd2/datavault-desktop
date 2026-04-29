/**
 * run-sync — Supabase Edge Function: chunked Notion sync.
 *
 * Optimised for the Supabase **free tier**:
 *   - 35 s time-boxed chunks (well under 150 s wall-clock limit).
 *   - Count-first: the first chunk does a fast /search count pass (capped
 *     at 5 s) to discover total items before copying. This gives accurate
 *     progress percentages and lets the frontend show time-remaining.
 *   - Batch-loads all known timestamps at chunk start (2-3 DB queries)
 *     instead of per-item SELECTs (saves hundreds of round-trips).
 *   - Resumes stale running jobs when the user presses Sync Now again
 *     after closing the tab (reads saved chunk_state).
 *
 * Smart-skip: pages/databases/rows whose last_edited_time has not changed
 * since our last copy are skipped. Pass force=true to bypass this.
 *
 * Orphan cleanup: when the full search is exhausted (not a partial chunk),
 * rows in our DB that were not seen in Notion are deleted.
 *
 * Deep sync additions (v2):
 *   - Fetches workspace users (/v1/users) once at sync start.
 *   - Fetches comments (/v1/comments) per page.
 *   - Extracts richer metadata: created_time, created_by, last_edited_by,
 *     icon, cover for pages/databases/rows.
 *
 * Local-first vault mode (DATAVAULT_STORE_FULL_PAYLOAD=false):
 *   Page bodies are uploaded as .md files to the vault-exports Storage bucket
 *   under {userId}/{connectorId}/pages/{notionPageId}.md instead of being
 *   stored as raw_json blocks in notion_pages. The DB row keeps only metadata
 *   (id, title, parent_id, url, last_edited_time). Deletes also remove the
 *   corresponding Storage object. The done response includes vault_pages_in_storage=true
 *   so the client can show a "download your vault" prompt.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pageToMarkdown, blocksToMarkdown, renderProperty, type NotionBlock } from "./notionMarkdown.ts";
import { handleTrelloSyncChunk } from "./trelloSync.ts";
import { handleTodoistSyncChunk } from "./todoistSync.ts";
import { handleAsanaSyncChunk } from "./asanaSync.ts";
import { handleAirtableSyncChunk } from "./airtableSync.ts";
import { handleGoogleSheetsSyncChunk } from "./googleSheetsSync.ts";

// ── Constants ────────────────────────────────────────────────────────────────

const NOTION_VERSION = "2022-06-28";
const NOTION_BASE = "https://api.notion.com/v1";
const CHUNK_TIME_MS = 35_000;
/** Per-page wall time to walk the block tree.
 *  20 s gives complete content for complex pages with deep toggles/callouts.
 *  Each 35 s chunk processes 1-2 pages — slower but complete. */
const BLOCK_TREE_BUDGET_MS = 20_000;
const MAX_RETRIES = 3;
const BACKOFF = [1_000, 2_000, 4_000];
const STALE_JOB_MS = 30 * 60 * 1_000;
const ORPHAN_CLEANUP_MAX_IDS = 8_000;
const BATCH_TIMESTAMP_LIMIT = 10_000;
/** Max wall-clock time to spend on the count-only pass (ms). */
const COUNT_BUDGET_MS = 5_000;

// CORS: browsers preflight with OPTIONS; gateway + Edge must allow anon key + auth + JSON.
// Include Methods so non-simple POST (JSON body + Authorization) passes the preflight check.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version, prefer",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

/**
 * When false, page bodies are written as .md to Storage (vault-exports bucket)
 * instead of stored as raw_json blocks in Postgres — the local-first model.
 * Set DATAVAULT_STORE_FULL_PAYLOAD=false as a Supabase Edge secret to enable.
 */
const STORE_FULL_PAYLOAD = Deno.env.get("DATAVAULT_STORE_FULL_PAYLOAD") !== "false";

/** Storage bucket name for vault mode. */
const VAULT_BUCKET = "vault-exports";

// ── Notion helpers with retry ────────────────────────────────────────────────

class NotionApiError extends Error {
  status: number;
  retryAfterMs: number | null;
  constructor(method: string, path: string, status: number, retryAfter: string | null) {
    super(`Notion ${method} ${path}: ${status}`);
    this.status = status;
    this.retryAfterMs = retryAfter ? Math.min(Number(retryAfter) * 1000, 30_000) : null;
  }
}

function friendlyNotionStatus(status: number): string {
  if (status === 401) return "Notion access was revoked — disconnect and reconnect Notion on your dashboard.";
  if (status === 403) return "Notion blocked access to some pages. Check which pages you shared with DataVault.";
  if (status === 429) return "Notion is rate-limiting us — we'll wait and retry automatically.";
  if (status >= 500) return "Notion's servers are having trouble right now. We'll retry shortly.";
  return `Notion returned an unexpected error (${status}).`;
}

/** Maps `connectors.type` to a short product name for errors (matches desktop `friendlyConnectorLabel`). */
function connectorSourceLabel(connType: string): string {
  const t = connType.toLowerCase().replace(/_/g, "-");
  switch (t) {
    case "notion":
      return "Notion";
    case "trello":
      return "Trello";
    case "todoist":
      return "Todoist";
    case "asana":
      return "Asana";
    case "airtable":
      return "Airtable";
    case "google-sheets":
      return "Google Sheets";
    default:
      return connType ? connType.charAt(0).toUpperCase() + connType.slice(1) : "this source";
  }
}

/**
 * run-sync only implements the Notion /search + block pipeline.
 * Trello (etc.) tokens were incorrectly sent to api.notion.com → 401 → misleading "Notion revoked" copy.
 */
function unsupportedConnectorMessage(connType: string): string {
  const label = connectorSourceLabel(connType);
  return `${label} backup is not available in this cloud sync yet — only Notion runs here. Keep your ${label} link on Platforms; we will add ${label}-specific backup next.`;
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function notionFetch(
  token: string, method: "GET" | "POST", path: string,
  body?: Record<string, unknown>, params?: Record<string, string>,
): Promise<unknown> {
  let lastErr: NotionApiError | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const url = new URL(`${NOTION_BASE}${path}`);
      if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      const init: RequestInit = {
        method,
        headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
      };
      if (body && method === "POST") init.body = JSON.stringify(body);
      const r = await fetch(url.toString(), init);
      if (r.ok) return r.json();
      const retryAfter = r.headers.get("Retry-After");
      lastErr = new NotionApiError(method, path, r.status, retryAfter);
      if (r.status === 401) throw lastErr;
      if (r.status === 429 && retryAfter) {
        if (attempt < MAX_RETRIES) { await sleep(Math.min(Number(retryAfter) * 1000, 15_000)); continue; }
      }
      if (r.status >= 400 && r.status < 500 && r.status !== 429 && r.status !== 408) throw lastErr;
      if (attempt < MAX_RETRIES) { await sleep(BACKOFF[attempt] ?? 4_000); continue; }
    } catch (e) {
      if (e instanceof NotionApiError) throw e;
      if (attempt < MAX_RETRIES) { await sleep(BACKOFF[attempt] ?? 4_000); continue; }
      throw new Error(`Network error calling Notion ${method} ${path} after ${MAX_RETRIES + 1} attempts: ${e}`);
    }
  }
  throw lastErr ?? new Error(`Notion ${method} ${path} failed after retries`);
}

async function notionGet(token: string, path: string, params?: Record<string, string>) {
  return notionFetch(token, "GET", path, undefined, params) as Promise<Record<string, unknown>>;
}
async function notionPost(token: string, path: string, body: Record<string, unknown>) {
  return notionFetch(token, "POST", path, body) as Promise<Record<string, unknown>>;
}

// ── Data extraction helpers ──────────────────────────────────────────────────

function richTextPlain(arr: unknown): string | null {
  if (!Array.isArray(arr)) return null;
  return arr.map((x: { plain_text?: string }) => x.plain_text ?? "").join("") || null;
}

function pageTitle(page: Record<string, unknown>): string | null {
  const props = (page.properties ?? {}) as Record<string, Record<string, unknown>>;
  for (const p of Object.values(props)) {
    if (!p || typeof p !== "object") continue;
    if (p.type === "title") {
      const t = richTextPlain(p.title)?.trim();
      if (t) return t;
    }
  }
  return null;
}

function parentId(page: Record<string, unknown>): string | null {
  const parent = (page.parent ?? {}) as Record<string, unknown>;
  const pt = parent.type as string | undefined;
  if (pt === "page_id") return parent.page_id as string;
  if (pt === "database_id") return parent.database_id as string;
  if (pt === "block_id") return parent.block_id as string;
  return null;
}

function databaseTitle(db: Record<string, unknown>): string | null {
  const title = db.title;
  return Array.isArray(title) ? richTextPlain(title) : null;
}

/** Extract icon emoji (or null) from a page or database object. */
function extractIconEmoji(item: Record<string, unknown>): string | null {
  const icon = item.icon as { type?: string; emoji?: string } | null;
  if (icon?.type === "emoji" && icon.emoji) return icon.emoji;
  return null;
}

/** Extract cover URL (external or Notion-hosted) from a page or database. */
function extractCoverUrl(item: Record<string, unknown>): string | null {
  const cover = item.cover as { type?: string; external?: { url?: string }; file?: { url?: string } } | null;
  if (!cover) return null;
  return cover.external?.url ?? cover.file?.url ?? null;
}

/** Extract the user ID from a {object:"user", id:"..."} field. */
function extractUserId(field: unknown): string | null {
  if (!field || typeof field !== "object") return null;
  return (field as { id?: string }).id ?? null;
}

async function fetchBlockTree(token: string, blockId: string, deadline: number): Promise<unknown[]> {
  if (Date.now() >= deadline) return [];
  const blocks: unknown[] = [];
  let cursor: string | undefined;
  while (Date.now() < deadline) {
    const params: Record<string, string> = { page_size: "100" };
    if (cursor) params.start_cursor = cursor;
    let data: Record<string, unknown>;
    try { data = await notionGet(token, `/blocks/${blockId}/children`, params); } catch { break; }
    for (const block of ((data.results ?? []) as Record<string, unknown>[])) {
      // Cast explicitly so TypeScript knows b keeps the full Record index signature.
      const b = { ...block, children: [] as unknown[] } as Record<string, unknown> & { children: unknown[] };
      if (b.has_children && b.id && Date.now() < deadline) {
        try { b.children = await fetchBlockTree(token, b.id as string, deadline); } catch { /* ok */ }
      }
      blocks.push(b);
    }
    if (!data.has_more) break;
    cursor = data.next_cursor as string | undefined;
    if (!cursor) break;
  }
  return blocks;
}

// ── Comment fetching ─────────────────────────────────────────────────────────

type CommentRow = {
  id: string;
  connector_id: string;
  page_id: string;
  block_id: string | null;
  rich_text: unknown;
  plain_text: string | null;
  created_time: string | null;
  last_edited_time: string | null;
  created_by_id: string | null;
  created_by_name: string | null;
  raw_json: unknown;
};

async function fetchAndStoreComments(
  token: string,
  admin: AdminClient,
  connectorId: string,
  pageId: string,
  deadline: number,
): Promise<number> {
  if (Date.now() >= deadline) return 0;
  let cursor: string | undefined;
  let count = 0;
  while (Date.now() < deadline) {
    const params: Record<string, string> = { block_id: pageId, page_size: "100" };
    if (cursor) params.start_cursor = cursor;
    let data: Record<string, unknown>;
    try { data = await notionGet(token, "/comments", params); } catch { break; }

    const results = (data.results ?? []) as Record<string, unknown>[];
    for (const c of results) {
      const cid = c.id as string;
      if (!cid) continue;

      const parent = c.parent as { type?: string; page_id?: string; block_id?: string } | undefined;
      const blockId = parent?.type === "block_id" ? parent.block_id ?? null : null;
      const richText = c.rich_text ?? [];
      const plainText = richTextPlain(richText);
      const createdBy = c.created_by as { id?: string; name?: string } | undefined;

      const row: CommentRow = {
        id: cid,
        connector_id: connectorId,
        page_id: pageId,
        block_id: blockId,
        rich_text: richText,
        plain_text: plainText,
        created_time: (c.created_time as string) ?? null,
        last_edited_time: (c.last_edited_time as string) ?? null,
        created_by_id: createdBy?.id ?? null,
        created_by_name: createdBy?.name ?? null,
        raw_json: c,
      };

      await admin.from("notion_comments").upsert(row, { onConflict: "connector_id,id" });
      count++;
    }

    if (!data.has_more) break;
    cursor = data.next_cursor as string | undefined;
    if (!cursor) break;
  }
  return count;
}

// ── User fetching ────────────────────────────────────────────────────────────

async function fetchAndStoreUsers(
  token: string,
  admin: AdminClient,
  connectorId: string,
  deadline: number,
): Promise<number> {
  if (Date.now() >= deadline) return 0;
  let cursor: string | undefined;
  let count = 0;
  while (Date.now() < deadline) {
    const params: Record<string, string> = { page_size: "100" };
    if (cursor) params.start_cursor = cursor;
    let data: Record<string, unknown>;
    try { data = await notionGet(token, "/users", params); } catch { break; }

    const results = (data.results ?? []) as Record<string, unknown>[];
    for (const u of results) {
      const uid = u.id as string;
      if (!uid) continue;

      const userType = (u.type as string) ?? null;
      const person = u.person as { email?: string } | undefined;
      const bot = u.bot as Record<string, unknown> | undefined;

      await admin.from("notion_users").upsert({
        id: uid,
        connector_id: connectorId,
        name: (u.name as string) ?? null,
        avatar_url: (u.avatar_url as string) ?? null,
        email: person?.email ?? null,
        user_type: userType,
        raw_json: u,
      }, { onConflict: "connector_id,id" });
      count++;
    }

    if (!data.has_more) break;
    cursor = data.next_cursor as string | undefined;
    if (!cursor) break;
  }
  return count;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function jsonResp(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type AdminClient = ReturnType<typeof createClient>;

async function jobIsCancelled(admin: AdminClient, jobId: string): Promise<boolean> {
  const { data } = await admin.from("sync_jobs").select("status").eq("id", jobId).maybeSingle();
  return data?.status === "cancelled";
}

type TsMap = Map<string, number>;
async function loadTimestamps(admin: AdminClient, table: string, connectorId: string): Promise<TsMap> {
  const map: TsMap = new Map();
  const { data } = await admin
    .from(table).select("id, last_edited_time")
    .eq("connector_id", connectorId).limit(BATCH_TIMESTAMP_LIMIT);
  if (data) {
    for (const row of data as { id: string; last_edited_time: string | null }[]) {
      if (row.last_edited_time) map.set(row.id, new Date(row.last_edited_time).getTime());
    }
  }
  return map;
}

function isSkippable(map: TsMap, itemId: string, notionEdited: string | null): boolean {
  if (!notionEdited) return false;
  const stored = map.get(itemId);
  if (stored === undefined) return false;
  return stored >= new Date(notionEdited).getTime();
}

/** "X of Y items" format with accurate total. */
function progressLabel(
  p: number, d: number, r: number, s: number, c: number,
  total: number, countDone: boolean,
): string {
  const processed = p + d + s;
  const ofTotal = total > 0 ? ` of ${total}${countDone ? "" : "+"}` : "";
  const parts = [`${processed}${ofTotal} items`];
  if (r > 0) parts.push(`${r} rows`);
  if (c > 0) parts.push(`${c} comments`);
  return parts.join(" · ");
}

/** Compute progress_pct from processed count vs known total. */
function calcPct(processed: number, total: number): number {
  if (total <= 0) return Math.min(85, 5 + processed);
  return Math.min(95, Math.round((processed / total) * 95));
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "POST only" }, 405);

  const chunkStart = Date.now();
  const timeLeft = () => CHUNK_TIME_MS - (Date.now() - chunkStart);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) return jsonResp({ error: "Server not configured", code: "NOT_CONFIGURED" }, 500);

  const authHeader = req.headers.get("Authorization") ?? "";
  const presentedToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!presentedToken) return jsonResp({ error: "Authorization required" }, 401);

  // Internal-trigger path (auto-backup): the tick function (`auto-sync-tick`)
  // calls us with the service-role key and an `x-internal-trigger` header.
  // When that matches, skip user-JWT validation and read user_id from the body.
  const internalTrigger = req.headers.get("x-internal-trigger") ?? "";
  const isInternal = internalTrigger === "auto-backup" && presentedToken === serviceRoleKey;

  const admin = createClient(supabaseUrl, serviceRoleKey);

  // ── Parse body (we need user_id from the body for internal calls) ─────────
  let body: {
    connector_id?: string; job_id?: string; cursor?: string;
    page_count?: number; db_count?: number; row_count?: number;
    skip_count?: number; comment_count?: number;
    seen_page_ids?: string[]; seen_db_ids?: string[];
    force?: boolean; total_items?: number; count_complete?: boolean;
    users_fetched?: boolean;
    /** Trello (etc.) continuation — echoed from needs_more responses. */
    kind_state?: Record<string, unknown>;
    /** Only honoured when `x-internal-trigger: auto-backup` is set. */
    user_id?: string;
  };
  try { body = await req.json(); } catch { return jsonResp({ error: "Invalid JSON body" }, 400); }

  let userId: string;
  if (isInternal) {
    if (!body.user_id) return jsonResp({ error: "user_id required for internal trigger" }, 400);
    userId = body.user_id;
  } else {
    const { data: userData, error: authError } = await admin.auth.getUser(presentedToken);
    if (authError || !userData?.user) return jsonResp({ error: "Invalid or expired session" }, 401);
    userId = userData.user.id;
  }

  const connectorId = body.connector_id;
  if (!connectorId) return jsonResp({ error: "connector_id required" }, 400);

  // Wrap the rest of the handler in an IIFE so we can post-process the response
  // for internal (auto-backup) triggers without rewiring every return path —
  // record success/failure on connectors and self-invoke for chunked continuation.
  // For user-triggered calls this wrapper is transparent.
  const resp = await (async (): Promise<Response> => {

  let searchCursor: string | undefined = body.cursor ?? undefined;
  let pageCount = body.page_count ?? 0;
  let dbCount = body.db_count ?? 0;
  let rowCount = body.row_count ?? 0;
  let skipCount = body.skip_count ?? 0;
  let commentCount = body.comment_count ?? 0;
  let forceRefresh = body.force === true;
  let totalItems = body.total_items ?? 0;
  let countComplete = body.count_complete ?? false;
  let usersFetched = body.users_fetched ?? false;
  const isFirstChunk = !body.job_id;

  const seenPageIds: Set<string> = new Set(body.seen_page_ids ?? []);
  const seenDbIds: Set<string> = new Set(body.seen_db_ids ?? []);
  const trackOrphans = (seenPageIds.size + seenDbIds.size) < ORPHAN_CLEANUP_MAX_IDS;

  // ── Verify connector ──────────────────────────────────────────────────────
  const { data: connector, error: connErr } = await admin
    .from("connectors")
    .select("id, user_id, access_token, refresh_token, token_expires_at, type")
    .eq("id", connectorId)
    .maybeSingle();
  if (connErr || !connector) return jsonResp({ error: "Connector not found" }, 404);
  if (connector.user_id !== userId) return jsonResp({ error: "Not your connector" }, 403);
  const notionToken = connector.access_token as string;
  const connectorDbType = String((connector as { type?: string | null }).type ?? "notion").trim() || "notion";
  if (!notionToken) {
    return jsonResp(
      { error: `No access token — reconnect ${connectorSourceLabel(connectorDbType)} on Platforms.` },
      400,
    );
  }

  // ── Stale job recovery ─────────────────────────────────────────────────────
  const { data: staleJobs } = await admin.from("sync_jobs").select("id")
    .eq("connector_id", connectorId).eq("status", "running")
    .lt("started_at", new Date(Date.now() - STALE_JOB_MS).toISOString()).limit(5);
  if (staleJobs && staleJobs.length > 0) {
    for (const sj of staleJobs) {
      await admin.from("sync_jobs").update({
        status: "failed", finished_at: new Date().toISOString(),
        progress_step: "Backup timed out — try again.",
      }).eq("id", sj.id);
    }
  }

  // ── Claim, resume, or start job ────────────────────────────────────────────
  let jobId: string | null = body.job_id ?? null;

  if (jobId) {
    const { data: existing } = await admin.from("sync_jobs").select("id, status").eq("id", jobId).maybeSingle();
    if (!existing) return jsonResp({ status: "done", message: "Job already finished" });
    if (existing.status === "cancelled") return jsonResp({ status: "cancelled" });
    if (existing.status === "done" || existing.status === "failed") {
      return jsonResp({ status: "done", message: "Job already finished" });
    }
  } else {
    const { data: pending } = await admin.from("sync_jobs").select("id")
      .eq("connector_id", connectorId).eq("status", "pending")
      .order("created_at", { ascending: true }).limit(1);

    if (pending && pending.length > 0) {
      jobId = pending[0].id;
      const startStep =
        connectorDbType.toLowerCase() === "notion"
          ? "Counting items in your Notion workspace…"
          : `Starting ${connectorSourceLabel(connectorDbType)} backup…`;
      await admin.from("sync_jobs").update({
        status: "running", started_at: new Date().toISOString(),
        progress_pct: 3,
        progress_step: startStep,
      }).eq("id", jobId);
    } else {
      const { data: running } = await admin.from("sync_jobs")
        .select("id, chunk_state")
        .eq("connector_id", connectorId).eq("status", "running").limit(1);

      if (running && running.length > 0) {
        jobId = running[0].id;
        const cs = (running[0].chunk_state ?? {}) as Record<string, unknown>;
        searchCursor = (cs.search_cursor as string) ?? undefined;
        pageCount = (cs.page_count as number) ?? 0;
        dbCount = (cs.db_count as number) ?? 0;
        rowCount = (cs.row_count as number) ?? 0;
        skipCount = (cs.skip_count as number) ?? 0;
        commentCount = (cs.comment_count as number) ?? 0;
        forceRefresh = (cs.force as boolean) ?? false;
        totalItems = (cs.total_items as number) ?? 0;
        countComplete = (cs.count_complete as boolean) ?? false;
        usersFetched = (cs.users_fetched as boolean) ?? false;
        if (Array.isArray(cs.seen_page_ids)) for (const id of cs.seen_page_ids) seenPageIds.add(id as string);
        if (Array.isArray(cs.seen_db_ids)) for (const id of cs.seen_db_ids) seenDbIds.add(id as string);
      } else {
        return jsonResp({ status: "no_pending" });
      }
    }
  }

  if (!jobId) return jsonResp({ error: "Could not create sync job" }, 500);
  if (await jobIsCancelled(admin, jobId)) return jsonResp({ status: "cancelled" });

  const connectorKind = connectorDbType.toLowerCase();
  if (connectorKind === "trello") {
    return await handleTrelloSyncChunk(admin, {
      userId,
      connectorId,
      jobId,
      trelloToken: notionToken,
      chunkStart,
      body: body as unknown as Record<string, unknown>,
    });
  }
  if (connectorKind === "todoist") {
    return await handleTodoistSyncChunk(admin, {
      userId,
      connectorId,
      jobId,
      token: notionToken,
      chunkStart,
    });
  }
  if (connectorKind === "asana") {
    return await handleAsanaSyncChunk(admin, {
      userId,
      connectorId,
      jobId,
      token: notionToken,
      refreshToken: (connector as { refresh_token?: string | null }).refresh_token ?? null,
      tokenExpiresAt: (connector as { token_expires_at?: string | null }).token_expires_at ?? null,
      chunkStart,
    });
  }
  if (connectorKind === "airtable") {
    return await handleAirtableSyncChunk(admin, {
      userId,
      connectorId,
      jobId,
      token: notionToken,
      refreshToken: (connector as { refresh_token?: string | null }).refresh_token ?? null,
      tokenExpiresAt: (connector as { token_expires_at?: string | null }).token_expires_at ?? null,
      chunkStart,
    });
  }
  if (connectorKind === "google-sheets" || connectorKind === "google_sheets") {
    return await handleGoogleSheetsSyncChunk(admin, {
      userId,
      connectorId,
      jobId,
      token: notionToken,
      refreshToken: (connector as { refresh_token?: string | null }).refresh_token ?? null,
      tokenExpiresAt: (connector as { token_expires_at?: string | null }).token_expires_at ?? null,
      chunkStart,
    });
  }
  if (connectorKind !== "notion") {
    const msg = unsupportedConnectorMessage(connectorKind).slice(0, 500);
    await admin.from("sync_jobs").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      progress_pct: 100,
      progress_step: msg,
      chunk_state: null,
    }).eq("id", jobId);
    return jsonResp({ status: "failed", error: msg });
  }

  // ── Batch-load existing timestamps ─────────────────────────────────────────
  const pageTs = forceRefresh ? new Map() : await loadTimestamps(admin, "notion_pages", connectorId);
  const dbTs = forceRefresh ? new Map() : await loadTimestamps(admin, "notion_databases", connectorId);
  const rowTs = forceRefresh ? new Map() : await loadTimestamps(admin, "notion_database_rows", connectorId);

  // ── chunk_state builder (used by updateProgress and needsMoreResp) ─────────
  const buildChunkState = () => ({
    search_cursor: searchCursor ?? null,
    page_count: pageCount, db_count: dbCount, row_count: rowCount,
    skip_count: skipCount, comment_count: commentCount,
    seen_page_ids: trackOrphans ? [...seenPageIds] : null,
    seen_db_ids: trackOrphans ? [...seenDbIds] : null,
    force: forceRefresh, total_items: totalItems, count_complete: countComplete,
    users_fetched: usersFetched,
  });

  const updateProgress = async (pct: number, step: string) => {
    await admin.from("sync_jobs").update({
      progress_pct: pct, progress_step: step, chunk_state: buildChunkState(),
    }).eq("id", jobId);
  };

  const needsMoreResp = () => jsonResp({
    status: "needs_more", job_id: jobId, connector_id: connectorId,
    cursor: searchCursor, page_count: pageCount, db_count: dbCount,
    row_count: rowCount, skip_count: skipCount, comment_count: commentCount,
    seen_page_ids: trackOrphans ? [...seenPageIds] : undefined,
    seen_db_ids: trackOrphans ? [...seenDbIds] : undefined,
    force: forceRefresh || undefined,
    total_items: totalItems, count_complete: countComplete,
    users_fetched: usersFetched,
  });

  // ── Count pass (first chunk only) ──────────────────────────────────────────
  // Fast /search loop that only counts results — no block fetching.
  // Capped at COUNT_BUDGET_MS so the rest of the chunk can do real work.
  try {
    if (isFirstChunk && totalItems === 0) {
      let countCursor: string | undefined;
      const countDeadline = Date.now() + COUNT_BUDGET_MS;

      while (Date.now() < countDeadline) {
        const cBody: Record<string, unknown> = { page_size: 100 };
        if (countCursor) cBody.start_cursor = countCursor;

        let cData: Record<string, unknown>;
        try {
          cData = await notionPost(notionToken, "/search", cBody);
        } catch (e) {
          if (e instanceof NotionApiError && e.status === 401) {
            await admin.from("sync_jobs").update({
              status: "failed", finished_at: new Date().toISOString(),
              progress_step: friendlyNotionStatus(401),
            }).eq("id", jobId);
            return jsonResp({ status: "failed", error: friendlyNotionStatus(401) });
          }
          break;
        }

        totalItems += ((cData.results ?? []) as unknown[]).length;

        if (!cData.has_more) { countComplete = true; break; }
        countCursor = cData.next_cursor as string | undefined;
        if (!countCursor) { countComplete = true; break; }
      }

      const suffix = countComplete ? "" : "+";
      await updateProgress(5, `Found ${totalItems}${suffix} items — starting backup…`);
    }

    // ── Fetch workspace users (once per sync) ────────────────────────────────
    if (!usersFetched && timeLeft() > 5_000) {
      try {
        const usersCount = await fetchAndStoreUsers(notionToken, admin, connectorId, Date.now() + Math.min(3_000, timeLeft() - 2_000));
        usersFetched = true;
        if (usersCount > 0) {
          await updateProgress(6, `Synced ${usersCount} workspace members — continuing…`);
        }
      } catch {
        // Non-critical: continue even if user fetch fails.
        usersFetched = true;
      }
    }

    // ── Sync loop ────────────────────────────────────────────────────────────
    let searchExhausted = false;

    while (timeLeft() > 3_000) {
      if (await jobIsCancelled(admin, jobId)) return jsonResp({ status: "cancelled" });

      const searchBody: Record<string, unknown> = { page_size: 100 };
      if (searchCursor) searchBody.start_cursor = searchCursor;

      let searchData: Record<string, unknown>;
      try {
        searchData = await notionPost(notionToken, "/search", searchBody);
      } catch (e) {
        if (await jobIsCancelled(admin, jobId)) return jsonResp({ status: "cancelled" });
        if (e instanceof NotionApiError && e.status === 401) {
          await admin.from("sync_jobs").update({
            status: "failed", finished_at: new Date().toISOString(),
            progress_step: friendlyNotionStatus(401),
          }).eq("id", jobId);
          return jsonResp({ status: "failed", error: friendlyNotionStatus(401) });
        }
        if (await jobIsCancelled(admin, jobId)) return jsonResp({ status: "cancelled" });
        const processed = pageCount + dbCount + skipCount;
        await updateProgress(calcPct(processed, totalItems), `Paused after ${processed} items — retrying shortly…`);
        return needsMoreResp();
      }

      const results = (searchData.results ?? []) as Record<string, unknown>[];

      // If count pass was incomplete, refine total as we see more search pages.
      if (!countComplete) {
        const newSeen = pageCount + dbCount + skipCount + results.length;
        if (newSeen > totalItems) totalItems = newSeen;
      }

      let processedInBatch = 0;

      for (const item of results) {
        processedInBatch++;
        if (processedInBatch % 5 === 0 && (await jobIsCancelled(admin, jobId))) return jsonResp({ status: "cancelled" });
        if (timeLeft() < 3_000) break;

        const obj = item.object as string;
        const iid = item.id as string;
        if (!iid) continue;

        if (obj === "page") {
          if (trackOrphans) seenPageIds.add(iid);

          if (item.archived) {
            await admin.from("notion_pages").delete().eq("connector_id", connectorId).eq("id", iid);
            await admin.from("notion_comments").delete().eq("connector_id", connectorId).eq("page_id", iid);
            // In local-first mode, also remove the Storage object for this page.
            if (!STORE_FULL_PAYLOAD) {
              await admin.storage.from(VAULT_BUCKET).remove([`${userId}/${connectorId}/pages/${iid}.md`]);
            }
            continue;
          }

          const notionEdited = (item.last_edited_time as string) ?? null;
          if (isSkippable(pageTs, iid, notionEdited)) { skipCount++; continue; }

          let blocks: unknown[] = [];
          if (timeLeft() > 5_000) {
            try { blocks = await fetchBlockTree(notionToken, iid, Date.now() + Math.min(BLOCK_TREE_BUDGET_MS, timeLeft() - 2_000)); } catch { /* ok */ }
          }

          // ── Extract rich metadata ──
          const createdTime = (item.created_time as string) ?? null;
          const createdById = extractUserId(item.created_by);
          const lastEditedById = extractUserId(item.last_edited_by);
          const iconEmoji = extractIconEmoji(item);
          const coverUrl = extractCoverUrl(item);

          if (!STORE_FULL_PAYLOAD) {
            // ── Local-first vault mode ─────────────────────────────────────────
            // Pull as much data as possible into the .md file:
            //   1. Inline databases → embedded as Markdown tables (up to 200 rows,
            //      with block content inside each row appended below the table).
            //   2. Child pages → block content embedded inline as subsections.

            // ── 1. Inline databases ────────────────────────────────────────────
            const inlineDbMap = new Map<string, string>();
            for (const blk of blocks as Record<string, unknown>[]) {
              if (blk.type !== "child_database" || !blk.id || timeLeft() < 4_000) continue;
              const dbId = blk.id as string;
              try {
                // Paginate up to 200 rows.
                const allRows: Record<string, unknown>[] = [];
                let dbCur: string | undefined;
                while (timeLeft() > 3_000 && allRows.length < 200) {
                  const qBody: Record<string, unknown> = { page_size: 100 };
                  if (dbCur) qBody.start_cursor = dbCur;
                  const qData = await notionPost(notionToken, `/databases/${dbId}/query`, qBody) as Record<string, unknown>;
                  allRows.push(...(qData.results ?? []) as Record<string, unknown>[]);
                  if (!qData.has_more) break;
                  dbCur = qData.next_cursor as string | undefined;
                  if (!dbCur) break;
                }

                if (allRows.length === 0) continue;

                const firstProps = allRows[0].properties as Record<string, unknown> ?? {};
                const propKeys = Object.keys(firstProps).slice(0, 10);
                const header = `| ${propKeys.join(" | ")} |`;
                const divider = `| ${propKeys.map(() => "---").join(" | ")} |`;

                const rowLines: string[] = [];
                for (const row of allRows) {
                  const props = row.properties as Record<string, Record<string, unknown>> ?? {};
                  const cells = propKeys.map((k) => {
                    const cell = (props[k] ?? {}) as Record<string, unknown>;
                    return renderProperty(cell).replace(/\|/g, "\\|").replace(/\n/g, " ");
                  });
                  rowLines.push(`| ${cells.join(" | ")} |`);

                  // Fetch block content inside the row (notes/body) and append after table.
                  if (timeLeft() > 3_000) {
                    try {
                      const rowBlocks = await fetchBlockTree(
                        notionToken, row.id as string,
                        Date.now() + Math.min(3_000, timeLeft() - 2_000),
                      );
                      if (rowBlocks.length > 0) {
                        const rowTitle = pageTitle(row) ?? row.id;
                        const rowMd = blocksToMarkdown(rowBlocks as NotionBlock[]);
                        rowLines.push(`\n> **${rowTitle}**\n>\n> ${rowMd.split("\n").join("\n> ")}`);
                      }
                    } catch { /* non-critical */ }
                  }
                }

                inlineDbMap.set(dbId, [header, divider, ...rowLines].join("\n"));
              } catch { /* non-critical — fallback to title-only */ }
            }

            // ── 2. Child pages ─────────────────────────────────────────────────
            const childPageMap = new Map<string, NotionBlock[]>();
            for (const blk of blocks as Record<string, unknown>[]) {
              if (blk.type !== "child_page" || !blk.id || timeLeft() < 4_000) continue;
              const childId = blk.id as string;
              try {
                const childBlocks = await fetchBlockTree(
                  notionToken, childId,
                  Date.now() + Math.min(8_000, timeLeft() - 3_000),
                );
                if (childBlocks.length > 0) {
                  childPageMap.set(childId, childBlocks as NotionBlock[]);
                }
              } catch { /* non-critical */ }
            }

            const mdContent = pageToMarkdown({
              id: iid,
              title: pageTitle(item),
              url: (item.url as string) ?? null,
              lastEditedTime: notionEdited,
              createdTime,
              iconEmoji,
              blocks: blocks as Parameters<typeof pageToMarkdown>[0]["blocks"],
              inlineDbMap,
              childPageMap,
            });
            const storagePath = `${userId}/${connectorId}/pages/${iid}.md`;
            await admin.storage.from(VAULT_BUCKET).upload(
              storagePath,
              new TextEncoder().encode(mdContent),
              { contentType: "text/markdown; charset=utf-8", upsert: true },
            );
            // Upsert metadata row only — no blocks in raw_json.
            for (let a = 0; a < 2; a++) {
              const { error: upErr } = await admin.from("notion_pages").upsert({
                connector_id: connectorId, id: iid, parent_id: parentId(item),
                title: pageTitle(item), url: (item.url as string) ?? null,
                last_edited_time: notionEdited, raw_json: { ...item, blocks: [] },
                created_time: createdTime, created_by_id: createdById,
                last_edited_by_id: lastEditedById, icon_emoji: iconEmoji,
                cover_url: coverUrl,
              }, { onConflict: "connector_id,id" });
              if (!upErr) break;
              if (a === 0) await sleep(500);
            }
          } else {
            // Standard mode: full raw_json with blocks in Postgres.
            for (let a = 0; a < 2; a++) {
              const { error: upErr } = await admin.from("notion_pages").upsert({
                connector_id: connectorId, id: iid, parent_id: parentId(item),
                title: pageTitle(item), url: (item.url as string) ?? null,
                last_edited_time: notionEdited, raw_json: { ...item, blocks },
                created_time: createdTime, created_by_id: createdById,
                last_edited_by_id: lastEditedById, icon_emoji: iconEmoji,
                cover_url: coverUrl,
              }, { onConflict: "connector_id,id" });
              if (!upErr) break;
              if (a === 0) await sleep(500);
            }
          }

          // Comments are now fetched in a batch pass after the search loop
          // to avoid 3 s overhead per page that was causing 1-page-per-chunk.

          pageCount++;
          if (notionEdited) pageTs.set(iid, new Date(notionEdited).getTime());

          if (pageCount % 2 === 0) {
            const processed = pageCount + dbCount + skipCount;
            await updateProgress(calcPct(processed, totalItems), progressLabel(pageCount, dbCount, rowCount, skipCount, commentCount, totalItems, countComplete));
          }

        } else if (obj === "database") {
          if (trackOrphans) seenDbIds.add(iid);

          if (item.archived) {
            await admin.from("notion_databases").delete().eq("connector_id", connectorId).eq("id", iid);
            continue;
          }

          const notionEdited = (item.last_edited_time as string) ?? null;
          if (isSkippable(dbTs, iid, notionEdited)) { skipCount++; continue; }

          // ── Extract richer database metadata ──
          const dbDescription = richTextPlain((item.description as unknown[]));
          const dbParentId = parentId(item);
          const dbUrl = (item.url as string) ?? null;
          const dbIconEmoji = extractIconEmoji(item);
          const dbCoverUrl = extractCoverUrl(item);
          const dbCreatedTime = (item.created_time as string) ?? null;

          await admin.from("notion_databases").upsert({
            connector_id: connectorId, id: iid, title: databaseTitle(item),
            properties: item.properties ?? {}, raw_json: item,
            last_edited_time: notionEdited,
            description: dbDescription, parent_id: dbParentId, url: dbUrl,
            icon_emoji: dbIconEmoji, cover_url: dbCoverUrl, created_time: dbCreatedTime,
          }, { onConflict: "connector_id,id" });
          dbCount++;

          let dbCursor: string | undefined;
          while (timeLeft() > 3_000) {
            if (await jobIsCancelled(admin, jobId)) return jsonResp({ status: "cancelled" });
            const qBody: Record<string, unknown> = { page_size: 100 };
            if (dbCursor) qBody.start_cursor = dbCursor;
            let qData: Record<string, unknown>;
            try { qData = await notionPost(notionToken, `/databases/${iid}/query`, qBody); }
            catch (e) { if (e instanceof NotionApiError && (e.status === 403 || e.status === 404)) break; throw e; }

            for (const row of (qData.results ?? []) as Record<string, unknown>[]) {
              const rid = row.id as string;
              if (!rid) continue;
              if (row.archived) {
                await admin.from("notion_database_rows").delete().eq("connector_id", connectorId).eq("id", rid);
                continue;
              }
              const rowEdited = (row.last_edited_time as string) ?? null;
              if (isSkippable(rowTs, rid, rowEdited)) { skipCount++; continue; }

              // ── Extract row metadata ──
              const rowCreatedTime = (row.created_time as string) ?? null;
              const rowCreatedById = extractUserId(row.created_by);
              const rowLastEditedById = extractUserId(row.last_edited_by);
              const rowUrl = (row.url as string) ?? null;
              const rowTitle = pageTitle(row);

              await admin.from("notion_database_rows").upsert({
                connector_id: connectorId, id: rid, database_id: iid,
                properties: row.properties ?? {}, last_edited_time: rowEdited, raw_json: row,
                created_time: rowCreatedTime, created_by_id: rowCreatedById,
                last_edited_by_id: rowLastEditedById, url: rowUrl, title: rowTitle,
              }, { onConflict: "connector_id,id" });
              rowCount++;
            }
            if (!qData.has_more) break;
            dbCursor = qData.next_cursor as string | undefined;
            if (!dbCursor) break;
          }
        }
      }

      if (!searchData.has_more) { searchExhausted = true; countComplete = true; break; }
      searchCursor = searchData.next_cursor as string | undefined;
      if (!searchCursor) { searchExhausted = true; countComplete = true; break; }
      if (timeLeft() < 3_000) break;
    }

    // ── Batch comment pass: use remaining chunk time to fetch comments ────────
    // Only runs when the search is exhausted (all pages seen). This avoids
    // the old per-page 3 s overhead that bottlenecked sync to 1 page/chunk.
    if (searchExhausted && seenPageIds.size > 0 && timeLeft() > 3_000) {
      const pageIdList = [...seenPageIds];
      for (const pid of pageIdList) {
        if (timeLeft() < 2_000) break;
        if (await jobIsCancelled(admin, jobId)) return jsonResp({ status: "cancelled" });
        try {
          const cc = await fetchAndStoreComments(
            notionToken, admin, connectorId, pid,
            Date.now() + Math.min(2_000, timeLeft() - 1_000),
          );
          commentCount += cc;
        } catch { /* non-critical */ }
      }
      const processed = pageCount + dbCount + skipCount;
      if (commentCount > 0) {
        await updateProgress(calcPct(processed, totalItems), progressLabel(pageCount, dbCount, rowCount, skipCount, commentCount, totalItems, countComplete));
      }
    }

    // ── Done or need another chunk ───────────────────────────────────────────
    if (searchExhausted) {
      if (await jobIsCancelled(admin, jobId)) return jsonResp({ status: "cancelled" });

      if (trackOrphans && seenPageIds.size > 0) {
        const { data: dbPages } = await admin.from("notion_pages").select("id").eq("connector_id", connectorId);
        if (dbPages) {
          const orphans = dbPages.map((r: { id: string }) => r.id).filter((id: string) => !seenPageIds.has(id));
          if (orphans.length > 0) {
            await admin.from("notion_pages").delete().eq("connector_id", connectorId).in("id", orphans);
            // Also remove orphaned comments.
            await admin.from("notion_comments").delete().eq("connector_id", connectorId).in("page_id", orphans);
            // In local-first mode, remove orphaned Storage objects too.
            if (!STORE_FULL_PAYLOAD) {
              const paths = orphans.map((id: string) => `${userId}/${connectorId}/pages/${id}.md`);
              // Remove in batches of 100 (Storage API limit).
              for (let i = 0; i < paths.length; i += 100) {
                await admin.storage.from(VAULT_BUCKET).remove(paths.slice(i, i + 100));
              }
            }
          }
        }
      }
      if (trackOrphans && seenDbIds.size > 0) {
        const { data: dbDbs } = await admin.from("notion_databases").select("id").eq("connector_id", connectorId);
        if (dbDbs) {
          const orphans = dbDbs.map((r: { id: string }) => r.id).filter((id: string) => !seenDbIds.has(id));
          if (orphans.length > 0) {
            await admin.from("notion_databases").delete().eq("connector_id", connectorId).in("id", orphans);
            await admin.from("notion_database_rows").delete().eq("connector_id", connectorId).in("database_id", orphans);
          }
        }
      }

      // pages_synced = total items seen in Notion (copied + skipped).
      // This gives a stable, consistent number across runs rather than
      // showing only the items that happened to change this session.
      const totalSeen = pageCount + dbCount + rowCount + skipCount;
      await admin.from("sync_jobs").update({
        status: "done", pages_synced: totalSeen,
        finished_at: new Date().toISOString(), progress_pct: 100,
        progress_step: progressLabel(pageCount, dbCount, rowCount, skipCount, commentCount, totalItems, true),
        chunk_state: null,
      }).eq("id", jobId);

      await admin.from("connectors").update({ last_synced_at: new Date().toISOString() }).eq("id", connectorId);

      return jsonResp({
        status: "done", job_id: jobId,
        pages: pageCount, databases: dbCount, rows: rowCount,
        skipped: skipCount, comments: commentCount,
        total_items: totalItems,
        // Tells the client that page bodies live in Storage, not raw_json.
        vault_pages_in_storage: !STORE_FULL_PAYLOAD,
      });
    }

    if (await jobIsCancelled(admin, jobId)) return jsonResp({ status: "cancelled" });
    const processed = pageCount + dbCount + skipCount;
    await updateProgress(calcPct(processed, totalItems), `${progressLabel(pageCount, dbCount, rowCount, skipCount, commentCount, totalItems, countComplete)} — continuing…`);
    return needsMoreResp();

  } catch (err) {
    if (await jobIsCancelled(admin, jobId)) return jsonResp({ status: "cancelled" });
    const message = err instanceof NotionApiError ? friendlyNotionStatus(err.status) : (err instanceof Error ? err.message : String(err));
    await admin.from("sync_jobs").update({
      status: "failed", finished_at: new Date().toISOString(),
      progress_step: `Backup failed: ${message.slice(0, 300)}`,
      chunk_state: buildChunkState(),
    }).eq("id", jobId);
    return jsonResp({ status: "failed", error: message.slice(0, 500) }, 500);
  }

  })(); // ── end of handler IIFE ────────────────────────────────────────────

  // ── Internal-trigger post-processing ─────────────────────────────────────
  // For auto-backup runs: record outcome on connectors + drive the next chunk
  // ourselves (no client is polling). User-triggered runs return as-is.
  if (isInternal) {
    try {
      const cloned = resp.clone();
      const payload = (await cloned.json()) as Record<string, unknown>;
      const statusVal = String(payload.status ?? "");
      const nowIso = new Date().toISOString();

      if (statusVal === "done") {
        await admin
          .from("connectors")
          .update({
            auto_backup_last_error: null,
            auto_backup_last_attempt_at: nowIso,
          })
          .eq("id", connectorId);
      } else if (statusVal === "failed" || statusVal === "cancelled") {
        const errMsg = String(payload.error ?? "Auto-backup failed");
        await admin
          .from("connectors")
          .update({
            auto_backup_last_error: errMsg.slice(0, 500),
            auto_backup_last_attempt_at: nowIso,
          })
          .eq("id", connectorId);
      } else if (statusVal === "needs_more") {
        // Drive the next chunk ourselves — no client is polling.
        const next: Record<string, unknown> = { ...payload, user_id: userId };
        delete next.status;
        const fireNext = fetch(`${supabaseUrl}/functions/v1/run-sync`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "x-internal-trigger": "auto-backup",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(next),
        }).catch((err) =>
          console.warn("[run-sync] auto-backup continuation failed:", err),
        );

        // @ts-expect-error EdgeRuntime is provided by the Supabase Edge runtime.
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
          // @ts-expect-error see above
          EdgeRuntime.waitUntil(fireNext);
        }
      }
    } catch (err) {
      console.warn("[run-sync] internal post-process failed:", err);
    }
  }

  return resp;
});
