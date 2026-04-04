/**
 * Scheduled sync trigger — called hourly by pg_cron.
 *
 * Security: requires Authorization: Bearer <CRON_SECRET> header.
 * Set CRON_SECRET in Edge Function secrets.
 *
 * What it does:
 *   1) Queries public.connectors for all active rows.
 *   2) Inserts a pending sync_jobs row for each connector.
 *   3) The Python sync-engine polls for pending jobs and processes them.
 *
 * Secrets: CRON_SECRET, SERVICE_ROLE_KEY (service_role JWT; not SUPABASE_SERVICE_ROLE_KEY — UI blocks that prefix).
 * SUPABASE_URL is auto-injected.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only", code: "METHOD" }), { status: 405 });
  }

  // Verify shared secret
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!CRON_SECRET || token !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized", code: "AUTH" }), { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey =
    Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Missing Supabase env vars", code: "NOT_CONFIGURED" }),
      { status: 500 },
    );
  }

  const client = createClient(supabaseUrl, serviceRoleKey);

  // Fetch all active connectors
  const { data: connectors, error: connError } = await client
    .from("connectors")
    .select("id, user_id")
    .eq("status", "active");

  if (connError) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch connectors", details: connError.message }),
      { status: 500 },
    );
  }

  if (!connectors || connectors.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, queued: 0, message: "No active connectors." }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // Insert a pending sync_jobs row per connector
  const jobs = connectors.map((c) => ({
    connector_id: c.id,
    status: "pending",
  }));

  const { error: insertError } = await client.from("sync_jobs").insert(jobs);

  if (insertError) {
    return new Response(
      JSON.stringify({ error: "Failed to queue jobs", details: insertError.message }),
      { status: 500 },
    );
  }

  return new Response(
    JSON.stringify({ ok: true, queued: jobs.length }),
    { headers: { "Content-Type": "application/json" } },
  );
});
