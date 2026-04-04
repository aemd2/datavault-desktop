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
import { pageToMarkdown } from "./notionMarkdown.ts";

// ── Constants ────────────────────────────────────────────────────────────────

const NOTION_VERSION = "2022-06-28";
const NOTION_BASE = "https://api.notion.com/v1";
const CHUNK_TIME_MS = 35_000;
/** Per-page wall time to walk the block tree (large pages need more than a few seconds). */
const BLOCK_TREE_BUDGET_MS = 25_000;
const MAX_RETRIES = 3;
const BACKOFF = [1_000, 2_000, 4_000];
const STALE_JOB_MS = 30 * 60 * 1_000;
const ORPHAN_CLEANUP_MAX_IDS = 8_000;
const BATCH_TIMESTAMP_LIMIT = 10_000;
/** Max wall-clock time to spend on the count-only pass (ms). */
const COUNT_BUDGET_MS = 5_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
  p: number, d: number, r: number, s: number,
  total: number, countDone: boolean,
): string {
  const processed = p + d + s;
  const ofTotal = total > 0 ? ` of ${total}${countDone ? "" : "+"}` : "";
  const parts = [`${processed}${ofTotal} items`];
  if (r > 0) parts.push(`${r} rows`);
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
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResp({ error: "Authorization required" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: userData, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !userData?.user) return jsonResp({ error: "Invalid or expired session" }, 401);
  const userId = userData.user.id;

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: {
    connector_id?: string; job_id?: string; cursor?: string;
    page_count?: number; db_count?: number; row_count?: number;
    skip_count?: number; seen_page_ids?: string[]; seen_db_ids?: string[];
    force?: boolean; total_items?: number; count_complete?: boolean;
  };
  try { body = await req.json(); } catch { return jsonResp({ error: "Invalid JSON body" }, 400); }

  const connectorId = body.connector_id;
  if (!connectorId) return jsonResp({ error: "connector_id required" }, 400);

  let searchCursor: string | undefined = body.cursor ?? undefined;
  let pageCount = body.page_count ?? 0;
  let dbCount = body.db_count ?? 0;
  let rowCount = body.row_count ?? 0;
  let skipCount = body.skip_count ?? 0;
  let forceRefresh = body.force === true;
  let totalItems = body.total_items ?? 0;
  let countComplete = body.count_complete ?? false;
  const isFirstChunk = !body.job_id;

  const seenPageIds: Set<string> = new Set(body.seen_page_ids ?? []);
  const seenDbIds: Set<string> = new Set(body.seen_db_ids ?? []);
  const trackOrphans = (seenPageIds.size + seenDbIds.size) < ORPHAN_CLEANUP_MAX_IDS;

  // ── Verify connector ──────────────────────────────────────────────────────
  const { data: connector, error: connErr } = await admin
    .from("connectors").select("id, user_id, access_token").eq("id", connectorId).maybeSingle();
  if (connErr || !connector) return jsonResp({ error: "Connector not found" }, 404);
  if (connector.user_id !== userId) return jsonResp({ error: "Not your connector" }, 403);
  const notionToken = connector.access_token as string;
  if (!notionToken) return jsonResp({ error: "No access token — reconnect Notion" }, 400);

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
      await admin.from("sync_jobs").update({
        status: "running", started_at: new Date().toISOString(),
        progress_pct: 3,
        progress_step: "Counting items in your Notion workspace…",
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
        forceRefresh = (cs.force as boolean) ?? false;
        totalItems = (cs.total_items as number) ?? 0;
        countComplete = (cs.count_complete as boolean) ?? false;
        if (Array.isArray(cs.seen_page_ids)) for (const id of cs.seen_page_ids) seenPageIds.add(id as string);
        if (Array.isArray(cs.seen_db_ids)) for (const id of cs.seen_db_ids) seenDbIds.add(id as string);
      } else {
        return jsonResp({ status: "no_pending" });
      }
    }
  }

  if (!jobId) return jsonResp({ error: "Could not create sync job" }, 500);
  if (await jobIsCancelled(admin, jobId)) return jsonResp({ status: "cancelled" });

  // ── Batch-load existing timestamps ─────────────────────────────────────────
  const pageTs = forceRefresh ? new Map() : await loadTimestamps(admin, "notion_pages", connectorId);
  const dbTs = forceRefresh ? new Map() : await loadTimestamps(admin, "notion_databases", connectorId);
  const rowTs = forceRefresh ? new Map() : await loadTimestamps(admin, "notion_database_rows", connectorId);

  // ── chunk_state builder (used by updateProgress and needsMoreResp) ─────────
  const buildChunkState = () => ({
    search_cursor: searchCursor ?? null,
    page_count: pageCount, db_count: dbCount, row_count: rowCount, skip_count: skipCount,
    seen_page_ids: trackOrphans ? [...seenPageIds] : null,
    seen_db_ids: trackOrphans ? [...seenDbIds] : null,
    force: forceRefresh, total_items: totalItems, count_complete: countComplete,
  });

  const updateProgress = async (pct: number, step: string) => {
    await admin.from("sync_jobs").update({
      progress_pct: pct, progress_step: step, chunk_state: buildChunkState(),
    }).eq("id", jobId);
  };

  const needsMoreResp = () => jsonResp({
    status: "needs_more", job_id: jobId, connector_id: connectorId,
    cursor: searchCursor, page_count: pageCount, db_count: dbCount,
    row_count: rowCount, skip_count: skipCount,
    seen_page_ids: trackOrphans ? [...seenPageIds] : undefined,
    seen_db_ids: trackOrphans ? [...seenDbIds] : undefined,
    force: forceRefresh || undefined,
    total_items: totalItems, count_complete: countComplete,
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
            // In local-first mode, also remove the Storage object for this page.
            if (!STORE_FULL_PAYLOAD) {
              await admin.storage.from(VAULT_BUCKET).remove([`${userId}/${connectorId}/pages/${iid}.md`]);
            }
            continue;
          }

          const notionEdited = (item.last_edited_time as string) ?? null;
          if (isSkippable(pageTs, iid, notionEdited)) { skipCount++; continue; }

          let blocks: unknown[] = [];
          if (timeLeft() > BLOCK_TREE_BUDGET_MS + 2_000) {
            try { blocks = await fetchBlockTree(notionToken, iid, Date.now() + Math.min(BLOCK_TREE_BUDGET_MS, timeLeft() - 2_000)); } catch { /* ok */ }
          }

          if (!STORE_FULL_PAYLOAD) {
            // Local-first vault mode: upload page body as Markdown to Storage.
            // Store only metadata (no block JSON) in notion_pages.
            const mdContent = pageToMarkdown({
              id: iid,
              title: pageTitle(item),
              url: (item.url as string) ?? null,
              lastEditedTime: notionEdited,
              blocks: blocks as Parameters<typeof pageToMarkdown>[0]["blocks"],
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
              }, { onConflict: "connector_id,id" });
              if (!upErr) break;
              if (a === 0) await sleep(500);
            }
          }

          pageCount++;
          if (notionEdited) pageTs.set(iid, new Date(notionEdited).getTime());

          if (pageCount % 3 === 0) {
            const processed = pageCount + dbCount + skipCount;
            await updateProgress(calcPct(processed, totalItems), progressLabel(pageCount, dbCount, rowCount, skipCount, totalItems, countComplete));
          }

        } else if (obj === "database") {
          if (trackOrphans) seenDbIds.add(iid);

          if (item.archived) {
            await admin.from("notion_databases").delete().eq("connector_id", connectorId).eq("id", iid);
            continue;
          }

          const notionEdited = (item.last_edited_time as string) ?? null;
          if (isSkippable(dbTs, iid, notionEdited)) { skipCount++; continue; }

          await admin.from("notion_databases").upsert({
            connector_id: connectorId, id: iid, title: databaseTitle(item),
            properties: item.properties ?? {}, raw_json: item,
            last_edited_time: notionEdited,
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
              await admin.from("notion_database_rows").upsert({
                connector_id: connectorId, id: rid, database_id: iid,
                properties: row.properties ?? {}, last_edited_time: rowEdited, raw_json: row,
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

    // ── Done or need another chunk ───────────────────────────────────────────
    if (searchExhausted) {
      if (await jobIsCancelled(admin, jobId)) return jsonResp({ status: "cancelled" });

      if (trackOrphans && seenPageIds.size > 0) {
        const { data: dbPages } = await admin.from("notion_pages").select("id").eq("connector_id", connectorId);
        if (dbPages) {
          const orphans = dbPages.map((r: { id: string }) => r.id).filter((id: string) => !seenPageIds.has(id));
          if (orphans.length > 0) {
            await admin.from("notion_pages").delete().eq("connector_id", connectorId).in("id", orphans);
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
        progress_step: progressLabel(pageCount, dbCount, rowCount, skipCount, totalItems, true),
        chunk_state: null,
      }).eq("id", jobId);

      await admin.from("connectors").update({ last_synced_at: new Date().toISOString() }).eq("id", connectorId);

      return jsonResp({
        status: "done", job_id: jobId,
        pages: pageCount, databases: dbCount, rows: rowCount, skipped: skipCount,
        total_items: totalItems,
        // Tells the client that page bodies live in Storage, not raw_json.
        vault_pages_in_storage: !STORE_FULL_PAYLOAD,
      });
    }

    if (await jobIsCancelled(admin, jobId)) return jsonResp({ status: "cancelled" });
    const processed = pageCount + dbCount + skipCount;
    await updateProgress(calcPct(processed, totalItems), `${progressLabel(pageCount, dbCount, rowCount, skipCount, totalItems, countComplete)} — continuing…`);
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
});
