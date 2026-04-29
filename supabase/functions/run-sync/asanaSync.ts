/**
 * Asana backup chunk for run-sync.
 * Fetches workspaces → projects → tasks from the Asana REST API.
 * Runs inside the same 35 s wall-clock budget as Trello/Notion chunks.
 *
 * Token refresh: Asana access tokens expire after 3600 s. We check
 * `token_expires_at` before every sync and use the stored `refresh_token`
 * to get a new access token if the current one is within 5 minutes of expiry.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Admin = ReturnType<typeof createClient>;

const ASANA_API = "https://app.asana.com/api/1.0";
const ASANA_TOKEN_URL = "https://app.asana.com/-/oauth_token";
const CHUNK_TIME_MS = 35_000;
const EXPIRY_BUFFER_MS = 5 * 60 * 1_000; // refresh 5 min before expiry

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version, prefer",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResp(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Use the stored refresh_token to get a fresh access_token from Asana.
 * Updates connectors.access_token and connectors.token_expires_at on success.
 * Returns the new access token, or null if refresh fails.
 */
async function refreshAsanaToken(
  admin: Admin,
  connectorId: string,
  refreshToken: string,
): Promise<string | null> {
  const clientId = Deno.env.get("ASANA_CLIENT_ID");
  const clientSecret = Deno.env.get("ASANA_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    console.warn("[asanaSync] ASANA_CLIENT_ID / ASANA_CLIENT_SECRET not set — cannot refresh token");
    return null;
  }
  try {
    const r = await fetch(ASANA_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }).toString(),
    });
    if (!r.ok) {
      console.error("[asanaSync] token refresh HTTP error:", r.status);
      return null;
    }
    const data = (await r.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
    };
    if (!data.access_token) return null;

    const tokenExpiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1_000).toISOString()
      : null;

    await admin.from("connectors").update({
      access_token: data.access_token,
      ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
      ...(tokenExpiresAt ? { token_expires_at: tokenExpiresAt } : {}),
    }).eq("id", connectorId);

    console.log("[asanaSync] token refreshed successfully");
    return data.access_token;
  } catch (e) {
    console.error("[asanaSync] token refresh exception:", e);
    return null;
  }
}

/** Asana wraps all responses in { data: ... } */
async function asanaGet(
  token: string,
  path: string,
  params?: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${ASANA_API}${path}`);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) {
      throw new Error(
        "Asana access has expired or was revoked — disconnect and reconnect Asana on Platforms.",
      );
    }
    throw new Error(`Asana API error ${r.status}: ${r.statusText}`);
  }
  const json = (await r.json()) as { data?: unknown };
  return json.data;
}

export async function handleAsanaSyncChunk(
  admin: Admin,
  opts: {
    userId: string;
    connectorId: string;
    jobId: string;
    token: string;
    refreshToken?: string | null;
    tokenExpiresAt?: string | null;
    chunkStart: number;
  },
): Promise<Response> {
  const { connectorId, jobId, chunkStart } = opts;
  const timeLeft = () => CHUNK_TIME_MS - (Date.now() - chunkStart);
  const now = new Date().toISOString();

  // ── Token freshness check ─────────────────────────────────────────────────
  // Asana access tokens expire in 1 hour. Refresh proactively if we're within
  // 5 minutes of expiry — avoids a mid-sync 401 on large workspaces.
  let token = opts.token;
  if (opts.tokenExpiresAt) {
    const expiresAt = new Date(opts.tokenExpiresAt).getTime();
    if (expiresAt < Date.now() + EXPIRY_BUFFER_MS) {
      if (opts.refreshToken) {
        const refreshed = await refreshAsanaToken(admin, connectorId, opts.refreshToken);
        if (refreshed) {
          token = refreshed;
        } else {
          await admin.from("sync_jobs").update({
            status: "failed",
            finished_at: now,
            progress_pct: 100,
            progress_step:
              "Asana session expired and could not be renewed. Disconnect this workspace and reconnect Asana from Platforms.",
            chunk_state: null,
          }).eq("id", jobId);
          return jsonResp({
            status: "failed",
            error: "Asana token expired and refresh failed. Please reconnect.",
          });
        }
      } else {
        await admin.from("sync_jobs").update({
          status: "failed",
          finished_at: now,
          progress_pct: 100,
          progress_step:
            "Asana session has expired. Disconnect this workspace and reconnect Asana from Platforms.",
          chunk_state: null,
        }).eq("id", jobId);
        return jsonResp({ status: "failed", error: "Asana token expired. Please reconnect." });
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  const updateProgress = async (pct: number, step: string) => {
    await admin.from("sync_jobs").update({ progress_pct: pct, progress_step: step }).eq("id", jobId);
  };

  const failJob = async (msg: string): Promise<Response> => {
    await admin.from("sync_jobs").update({
      status: "failed",
      finished_at: now,
      progress_pct: 100,
      progress_step: msg.slice(0, 500),
      chunk_state: null,
    }).eq("id", jobId);
    return jsonResp({ status: "failed", error: msg });
  };

  try {
    await updateProgress(5, "Fetching your Asana workspaces…");

    // 1 — Workspaces
    let workspaces: Array<{ gid: string; name: string }>;
    try {
      workspaces = (await asanaGet(token, "/workspaces")) as Array<{ gid: string; name: string }>;
    } catch (e) {
      return failJob(e instanceof Error ? e.message : "Failed to fetch Asana workspaces.");
    }

    if (!workspaces?.length) {
      await admin.from("sync_jobs").update({
        status: "done",
        pages_synced: 0,
        finished_at: now,
        progress_pct: 100,
        progress_step: "No Asana workspaces found.",
        chunk_state: null,
      }).eq("id", jobId);
      await admin.from("connectors").update({ last_synced_at: now }).eq("id", connectorId);
      return jsonResp({ status: "done", projects: 0, tasks: 0 });
    }

    await updateProgress(15, `${workspaces.length} workspace(s) found — fetching projects…`);

    let projectCount = 0;
    let taskCount = 0;
    const projectGids: string[] = [];

    // 2 — Projects per workspace
    for (const ws of workspaces) {
      if (timeLeft() < 6_000) break;
      let projects: Record<string, unknown>[];
      try {
        projects = (await asanaGet(token, "/projects", {
          workspace: ws.gid,
          limit: "100",
          opt_fields: "gid,name,notes,archived,modified_at",
        })) as Record<string, unknown>[];
      } catch {
        continue;
      }

      for (const p of (projects ?? [])) {
        if (timeLeft() < 4_000) break;
        const gid = String(p.gid);
        await admin.from("asana_projects").upsert(
          {
            id: gid,
            connector_id: connectorId,
            workspace_gid: ws.gid,
            name: (p.name as string) ?? "Untitled",
            notes: (p.notes as string) || null,
            archived: Boolean(p.archived),
            modified_at: (p.modified_at as string) ?? null,
          },
          { onConflict: "connector_id,id" },
        );
        projectGids.push(gid);
        projectCount++;
      }
    }

    await updateProgress(55, `${projectCount} project${projectCount === 1 ? "" : "s"} saved — fetching tasks…`);

    // 3 — Tasks per project
    for (const projGid of projectGids) {
      if (timeLeft() < 4_000) break;
      let tasks: Record<string, unknown>[];
      try {
        tasks = (await asanaGet(token, "/tasks", {
          project: projGid,
          limit: "100",
          opt_fields: "gid,name,notes,completed,due_on,modified_at",
        })) as Record<string, unknown>[];
      } catch {
        continue;
      }

      for (const t of (tasks ?? [])) {
        if (timeLeft() < 2_000) break;
        await admin.from("asana_tasks").upsert(
          {
            id: String(t.gid),
            connector_id: connectorId,
            project_gid: projGid,
            name: (t.name as string) ?? "",
            notes: (t.notes as string) || null,
            completed: Boolean(t.completed),
            due_on: (t.due_on as string) ?? null,
            modified_at: (t.modified_at as string) ?? null,
          },
          { onConflict: "connector_id,id" },
        );
        taskCount++;
      }
    }

    // Done
    const totalSeen = projectCount + taskCount;
    await admin.from("sync_jobs").update({
      status: "done",
      pages_synced: totalSeen,
      finished_at: now,
      progress_pct: 100,
      progress_step: `${projectCount} project${projectCount === 1 ? "" : "s"} · ${taskCount} task${taskCount === 1 ? "" : "s"} backed up`,
      chunk_state: null,
    }).eq("id", jobId);

    await admin.from("connectors").update({ last_synced_at: now }).eq("id", connectorId);

    return jsonResp({ status: "done", job_id: jobId, projects: projectCount, tasks: taskCount });
  } catch (err) {
    return failJob(err instanceof Error ? err.message : String(err));
  }
}
