/**
 * auto-sync-tick — Hourly cron worker that fans out auto-backups.
 *
 * Invoked by `pg_cron` (see migration `20260428000001_pg_cron_auto_sync.sql`)
 * with the service-role key as bearer token. Finds connectors whose
 * `auto_backup_enabled = true` and `last_synced_at < now() - 7 days`, then
 * fires `run-sync` for each one with the internal-trigger header so the run
 * can authenticate without a user JWT.
 *
 * The actual chunked sync work (and OAuth token refresh) happens inside
 * `run-sync` as usual; this function just enumerates + dispatches.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResp(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Connectors that lag a sync by more than 30 min are considered stuck — we still
// fan out for them. But within that window we skip to avoid duplicate work.
const STALE_RUN_MS = 30 * 60 * 1000;
// Hard cap on how many we kick off per tick — each one runs in its own
// Edge invocation so we avoid hitting per-tick wall-clock limits.
const MAX_PER_TICK = 100;
// Cloud-only connector kinds — Obsidian is local and doesn't go through run-sync.
const CLOUD_KINDS = new Set(["notion", "trello", "todoist", "asana", "airtable", "google-sheets"]);

interface DueConnector {
  id: string;
  user_id: string;
  type: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "POST only" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey =
    Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResp({ error: "Server not configured", code: "NOT_CONFIGURED" }, 500);
  }

  // ── Auth: must be the service-role key ────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const presentedToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (presentedToken !== serviceRoleKey) {
    return jsonResp({ error: "Forbidden" }, 403);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  // ── Find connectors due for an auto-backup ─────────────────────────────────
  // 7 day cadence — fetch a slightly larger threshold than 7 days exactly so
  // jobs that drift slightly later than a week still get picked up next tick.
  const dueBefore = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: candidates, error: candErr } = await admin
    .from("connectors")
    .select("id, user_id, type, last_synced_at")
    .eq("auto_backup_enabled", true)
    .or(`last_synced_at.is.null,last_synced_at.lt.${dueBefore}`)
    .limit(MAX_PER_TICK);

  if (candErr) {
    console.warn("[auto-sync-tick] connector query failed:", candErr.message);
    return jsonResp({ error: candErr.message }, 500);
  }

  if (!candidates || candidates.length === 0) {
    return jsonResp({ triggered: 0, skipped: 0, message: "Nothing due" });
  }

  // ── Skip connectors that have a recent in-flight job (≤30 min) ─────────────
  const recentRunCutoff = new Date(Date.now() - STALE_RUN_MS).toISOString();
  const { data: busyJobs } = await admin
    .from("sync_jobs")
    .select("connector_id")
    .in(
      "connector_id",
      candidates.map((c) => c.id),
    )
    .in("status", ["pending", "running"])
    .gte("started_at", recentRunCutoff);

  const busyIds = new Set((busyJobs ?? []).map((j) => j.connector_id as string));

  // Filter: skip Obsidian/unknown kinds (local-only, no run-sync) and busy ones.
  const due: DueConnector[] = candidates
    .filter((c) => {
      const kind = String(c.type ?? "").toLowerCase();
      return CLOUD_KINDS.has(kind) && !busyIds.has(c.id);
    })
    .map((c) => ({ id: c.id, user_id: c.user_id, type: String(c.type ?? "").toLowerCase() }));

  // ── Fan out: fire run-sync for each due connector ──────────────────────────
  const runSyncUrl = `${supabaseUrl}/functions/v1/run-sync`;
  for (const conn of due) {
    const fireOne = fetch(runSyncUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "x-internal-trigger": "auto-backup",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        connector_id: conn.id,
        user_id: conn.user_id, // run-sync uses this when JWT is absent
      }),
    }).catch((err) => {
      // Log + swallow: a failed fan-out shouldn't block the rest of the tick.
      console.warn(`[auto-sync-tick] fanout failed for ${conn.id}:`, err);
    });

    // Keep the request alive past `return` so the kicked-off sync survives.
    // @ts-expect-error EdgeRuntime is provided by the Supabase Edge runtime.
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-expect-error see above
      EdgeRuntime.waitUntil(fireOne);
    }
  }

  return jsonResp({
    triggered: due.length,
    skipped: candidates.length - due.length,
  });
});
