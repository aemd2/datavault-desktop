/**
 * Todoist backup chunk for run-sync.
 * Fetches all projects and active tasks from the Todoist REST v2 API.
 * Runs inside the same 35 s wall-clock budget as Trello/Notion chunks.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Admin = ReturnType<typeof createClient>;

// Todoist deprecated REST v2 (returns 410 Gone). New API is v1 under /api/.
const TODOIST_API = "https://api.todoist.com/api/v1";
const CHUNK_TIME_MS = 35_000;
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

async function todoistGet(token: string, path: string): Promise<unknown[]> {
  const r = await fetch(`${TODOIST_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) {
      throw new Error(
        "Todoist access was revoked — disconnect and reconnect Todoist on Platforms.",
      );
    }
    throw new Error(`Todoist API error ${r.status}: ${r.statusText}`);
  }
  const json = await r.json();
  // API v1 wraps list responses in { results: [...], next_cursor: ... }
  // Fall back to the raw value if it is already an array (forward-compat).
  return Array.isArray(json) ? json : ((json as { results?: unknown[] }).results ?? []);
}

export async function handleTodoistSyncChunk(
  admin: Admin,
  opts: {
    userId: string;
    connectorId: string;
    jobId: string;
    token: string;
    chunkStart: number;
  },
): Promise<Response> {
  const { connectorId, jobId, token, chunkStart } = opts;
  const timeLeft = () => CHUNK_TIME_MS - (Date.now() - chunkStart);
  const now = new Date().toISOString();

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
    await updateProgress(10, "Fetching your Todoist projects…");

    // 1 — Projects
    let projects: Record<string, unknown>[];
    try {
      projects = (await todoistGet(token, "/projects")) as Record<string, unknown>[];
      // todoistGet already extracts .results — projects is now a plain array
    } catch (e) {
      return failJob(e instanceof Error ? e.message : "Failed to fetch Todoist projects.");
    }

    let projectCount = 0;
    for (const p of (projects ?? [])) {
      if (timeLeft() < 3_000) break;
      await admin.from("todoist_projects").upsert(
        {
          id: String(p.id),
          connector_id: connectorId,
          name: (p.name as string) ?? "Untitled",
          color: (p.color as string) ?? null,
          parent_id: p.parent_id ? String(p.parent_id) : null,
          is_favorite: Boolean(p.is_favorite),
          last_seen_at: now,
        },
        { onConflict: "connector_id,id" },
      );
      projectCount++;
    }

    await updateProgress(40, `${projectCount} project${projectCount === 1 ? "" : "s"} saved — fetching tasks…`);

    // 2 — Active tasks (all at once — Todoist returns up to 8 192 per call at v2)
    let tasks: Record<string, unknown>[];
    try {
      tasks = (await todoistGet(token, "/tasks")) as Record<string, unknown>[];
    } catch (e) {
      return failJob(e instanceof Error ? e.message : "Failed to fetch Todoist tasks.");
    }

    let taskCount = 0;
    for (const t of (tasks ?? [])) {
      if (timeLeft() < 2_000) break;
      const due = t.due as { date?: string; datetime?: string } | null | undefined;
      await admin.from("todoist_tasks").upsert(
        {
          id: String(t.id),
          connector_id: connectorId,
          project_id: t.project_id ? String(t.project_id) : null,
          content: (t.content as string) ?? "",
          description: (t.description as string) || null,
          priority: typeof t.priority === "number" ? t.priority : 1,
          due: due?.datetime ?? due?.date ?? null,
          completed_at: null,
          last_seen_at: now,
        },
        { onConflict: "connector_id,id" },
      );
      taskCount++;
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
