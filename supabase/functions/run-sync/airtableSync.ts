/**
 * Airtable backup chunk for run-sync.
 * Fetches bases → tables (with field schemas) → records from the Airtable REST API.
 * Runs inside the same 35 s wall-clock budget as other sync handlers.
 *
 * Airtable OAuth access tokens expire after 60 minutes.
 * We check token_expires_at before syncing and refresh proactively if needed.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Admin = ReturnType<typeof createClient>;

const AIRTABLE_API = "https://api.airtable.com/v0";
const AIRTABLE_TOKEN_URL = "https://airtable.com/oauth2/v1/token";
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
 * Refresh Airtable OAuth token. Updates connectors table on success.
 * Returns new access token or null on failure.
 */
async function refreshAirtableToken(
  admin: Admin,
  connectorId: string,
  refreshToken: string,
): Promise<string | null> {
  const clientId = Deno.env.get("AIRTABLE_CLIENT_ID");
  const clientSecret = Deno.env.get("AIRTABLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    console.warn("[airtableSync] AIRTABLE_CLIENT_ID / AIRTABLE_CLIENT_SECRET not set");
    return null;
  }
  try {
    const credentials = btoa(`${clientId}:${clientSecret}`);
    const r = await fetch(AIRTABLE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });
    if (!r.ok) {
      console.error("[airtableSync] token refresh HTTP error:", r.status);
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

    console.log("[airtableSync] token refreshed successfully");
    return data.access_token;
  } catch (e) {
    console.error("[airtableSync] token refresh exception:", e);
    return null;
  }
}

async function airtableGet(
  token: string,
  path: string,
  params?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const url = new URL(`${AIRTABLE_API}${path}`);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) {
      throw new Error(
        "Airtable access was revoked — disconnect and reconnect Airtable on Platforms.",
      );
    }
    throw new Error(`Airtable API error ${r.status}: ${r.statusText}`);
  }
  return r.json() as Promise<Record<string, unknown>>;
}

export async function handleAirtableSyncChunk(
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

  // ── Token freshness check ──────────────────────────────────────────────────
  let token = opts.token;
  if (opts.tokenExpiresAt) {
    const expiresAt = new Date(opts.tokenExpiresAt).getTime();
    if (expiresAt < Date.now() + EXPIRY_BUFFER_MS) {
      if (opts.refreshToken) {
        const refreshed = await refreshAirtableToken(admin, connectorId, opts.refreshToken);
        if (refreshed) {
          token = refreshed;
        } else {
          await admin.from("sync_jobs").update({
            status: "failed",
            finished_at: now,
            progress_pct: 100,
            progress_step:
              "Airtable session expired and could not be renewed. Disconnect this workspace and reconnect from Platforms.",
            chunk_state: null,
          }).eq("id", jobId);
          return jsonResp({ status: "failed", error: "Airtable token expired and refresh failed." });
        }
      } else {
        await admin.from("sync_jobs").update({
          status: "failed",
          finished_at: now,
          progress_pct: 100,
          progress_step:
            "Airtable session has expired. Disconnect this workspace and reconnect from Platforms.",
          chunk_state: null,
        }).eq("id", jobId);
        return jsonResp({ status: "failed", error: "Airtable token expired. Please reconnect." });
      }
    }
  }

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
    await updateProgress(5, "Fetching your Airtable bases…");

    // 1 — Bases (via metadata API)
    let bases: Record<string, unknown>[];
    try {
      const data = await airtableGet(token, "/meta/bases");
      bases = (data.bases as Record<string, unknown>[]) ?? [];
    } catch (e) {
      return failJob(e instanceof Error ? e.message : "Failed to fetch Airtable bases.");
    }

    if (!bases.length) {
      await admin.from("sync_jobs").update({
        status: "done",
        pages_synced: 0,
        finished_at: now,
        progress_pct: 100,
        progress_step: "No Airtable bases found.",
        chunk_state: null,
      }).eq("id", jobId);
      await admin.from("connectors").update({ last_synced_at: now }).eq("id", connectorId);
      return jsonResp({ status: "done", bases: 0, tables: 0, records: 0 });
    }

    let baseCount = 0;
    let tableCount = 0;
    let recordCount = 0;

    for (const base of bases) {
      if (timeLeft() < 6_000) break;
      const baseId = String(base.id);

      // Upsert base
      await admin.from("airtable_bases").upsert(
        {
          connector_id: connectorId,
          id: baseId,
          name: (base.name as string) ?? "Untitled",
          permission_level: (base.permissionLevel as string) ?? null,
          last_synced_at: now,
        },
        { onConflict: "connector_id,id" },
      );
      baseCount++;

      await updateProgress(
        10 + Math.round((baseCount / bases.length) * 40),
        `Base ${baseCount}/${bases.length}: fetching tables…`,
      );

      // 2 — Tables + field schemas for this base
      let tables: Record<string, unknown>[];
      try {
        const data = await airtableGet(token, `/meta/bases/${baseId}/tables`);
        tables = (data.tables as Record<string, unknown>[]) ?? [];
      } catch {
        continue;
      }

      for (const table of tables) {
        if (timeLeft() < 4_000) break;
        const tableId = String(table.id);

        await admin.from("airtable_tables").upsert(
          {
            connector_id: connectorId,
            id: tableId,
            base_id: baseId,
            name: (table.name as string) ?? "Untitled",
            fields_json: table.fields ?? [],
            last_synced_at: now,
          },
          { onConflict: "connector_id,id" },
        );
        tableCount++;

        // 3 — Records for this table (paginated)
        let offset: string | undefined;
        while (timeLeft() > 3_000) {
          const params: Record<string, string> = { pageSize: "100" };
          if (offset) params.offset = offset;
          let page: Record<string, unknown>;
          try {
            page = await airtableGet(token, `/${baseId}/${tableId}`, params);
          } catch {
            break;
          }

          const records = (page.records as Record<string, unknown>[]) ?? [];
          for (const rec of records) {
            if (timeLeft() < 2_000) break;
            await admin.from("airtable_records").upsert(
              {
                connector_id: connectorId,
                id: String(rec.id),
                base_id: baseId,
                table_id: tableId,
                fields_json: rec.fields ?? {},
                created_time: (rec.createdTime as string) ?? null,
                last_modified_time: null,
                synced_at: now,
              },
              { onConflict: "connector_id,id" },
            );
            recordCount++;
          }

          if (!page.offset) break;
          offset = page.offset as string;
        }
      }
    }

    const totalSeen = baseCount + tableCount + recordCount;
    await admin.from("sync_jobs").update({
      status: "done",
      pages_synced: totalSeen,
      finished_at: now,
      progress_pct: 100,
      progress_step: `${baseCount} base${baseCount === 1 ? "" : "s"} · ${tableCount} table${tableCount === 1 ? "" : "s"} · ${recordCount} record${recordCount === 1 ? "" : "s"} backed up`,
      chunk_state: null,
    }).eq("id", jobId);

    await admin.from("connectors").update({ last_synced_at: now }).eq("id", connectorId);

    return jsonResp({ status: "done", job_id: jobId, bases: baseCount, tables: tableCount, records: recordCount });
  } catch (err) {
    return failJob(err instanceof Error ? err.message : String(err));
  }
}
