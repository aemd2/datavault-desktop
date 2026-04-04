/**
 * cancel-sync — Mark a pending or running sync_jobs row as cancelled (user stopped backup).
 *
 * POST { job_id: string }
 * Auth: Authorization: Bearer <user_jwt>
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResp(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "POST only" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) return jsonResp({ error: "Server not configured" }, 500);

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResp({ error: "Authorization required" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: userData, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !userData?.user) return jsonResp({ error: "Invalid or expired session" }, 401);
  const userId = userData.user.id;

  let body: { job_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "Invalid JSON body" }, 400);
  }

  const jobId = body.job_id?.trim();
  if (!jobId) return jsonResp({ error: "job_id required" }, 400);

  const { data: job, error: jobErr } = await admin
    .from("sync_jobs")
    .select("id, status, connector_id")
    .eq("id", jobId)
    .maybeSingle();

  if (jobErr || !job) return jsonResp({ error: "Job not found" }, 404);

  const { data: connector, error: connErr } = await admin
    .from("connectors")
    .select("user_id")
    .eq("id", job.connector_id)
    .maybeSingle();

  if (connErr || !connector || connector.user_id !== userId) {
    return jsonResp({ error: "Not allowed" }, 403);
  }

  if (job.status !== "pending" && job.status !== "running") {
    return jsonResp({ ok: true, applied: false, status: job.status });
  }

  const wasPending = job.status === "pending";
  const { error: updErr } = await admin
    .from("sync_jobs")
    .update({
      status: "cancelled",
      finished_at: new Date().toISOString(),
      progress_step: wasPending
        ? "Stopped — removed from the queue before it started."
        : "Stopped — you ended this backup. Press Sync Now when you want to continue.",
      chunk_state: null,
    })
    .eq("id", jobId);

  if (updErr) {
    return jsonResp(
      {
        error: "Could not stop this backup. If this keeps happening, contact support.",
        details: updErr.message,
      },
      500,
    );
  }

  return jsonResp({ ok: true, applied: true, status: "cancelled" });
});
