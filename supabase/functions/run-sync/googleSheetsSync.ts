/**
 * Google Sheets backup chunk for run-sync.
 * Flow: refresh token if needed → list spreadsheets (Drive API) →
 *       for each spreadsheet: fetch metadata + sheets → fetch row values per sheet.
 *
 * Google access tokens expire after 3600 s — we refresh proactively when
 * within 5 minutes of expiry using the stored refresh_token.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Admin = ReturnType<typeof createClient>;

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHUNK_TIME_MS = 35_000;
const EXPIRY_BUFFER_MS = 5 * 60 * 1_000;

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

async function refreshGoogleToken(
  admin: Admin,
  connectorId: string,
  refreshToken: string,
): Promise<string | null> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    console.warn("[googleSheetsSync] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set");
    return null;
  }
  try {
    const r = await fetch(GOOGLE_TOKEN_URL, {
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
      console.error("[googleSheetsSync] token refresh HTTP error:", r.status);
      return null;
    }
    const data = (await r.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return null;

    const tokenExpiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1_000).toISOString()
      : null;

    await admin.from("connectors").update({
      access_token: data.access_token,
      ...(tokenExpiresAt ? { token_expires_at: tokenExpiresAt } : {}),
    }).eq("id", connectorId);

    console.log("[googleSheetsSync] token refreshed successfully");
    return data.access_token;
  } catch (e) {
    console.error("[googleSheetsSync] token refresh exception:", e);
    return null;
  }
}

/** Sentinel thrown when a 401/403 is received, so callers can try a refresh. */
class GoogleAuthError extends Error {
  constructor() {
    super("Google access was revoked — disconnect and reconnect Google Sheets on Platforms.");
  }
}

async function googleGetRaw(
  token: string,
  url: string,
  params?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const u = new URL(url);
  if (params) for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!r.ok) {
    let detail = r.statusText;
    try {
      const body = await r.json() as { error?: { message?: string; status?: string } };
      detail = body?.error?.message ?? body?.error?.status ?? r.statusText;
    } catch { /* ignore */ }
    if (r.status === 401) throw new GoogleAuthError();
    if (r.status === 403) {
      // 403 can mean Drive API not enabled or scope not granted — show detail
      throw new Error(`Google API access denied (403): ${detail}`);
    }
    throw new Error(`Google API error ${r.status}: ${detail}`);
  }
  return r.json() as Promise<Record<string, unknown>>;
}

/**
 * googleGet with automatic one-shot token refresh on 401.
 * Returns the (possibly refreshed) token alongside the response so the
 * caller can update its local `token` variable.
 */
async function googleGet(
  token: string,
  url: string,
  params: Record<string, string> | undefined,
  admin: Admin,
  connectorId: string,
  refreshToken?: string | null,
): Promise<{ data: Record<string, unknown>; token: string }> {
  try {
    const data = await googleGetRaw(token, url, params);
    return { data, token };
  } catch (e) {
    // Only retry on 401 (token expired) — not on 403 (API not enabled / scope denied).
    if (e instanceof GoogleAuthError && refreshToken) {
      const newToken = await refreshGoogleToken(admin, connectorId, refreshToken);
      if (newToken) {
        const data = await googleGetRaw(newToken, url, params);
        return { data, token: newToken };
      }
    }
    throw e;
  }
}

export async function handleGoogleSheetsSyncChunk(
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

  // ── Token freshness ────────────────────────────────────────────────────────
  let token = opts.token;
  if (opts.tokenExpiresAt) {
    const expiresAt = new Date(opts.tokenExpiresAt).getTime();
    if (expiresAt < Date.now() + EXPIRY_BUFFER_MS) {
      if (opts.refreshToken) {
        const refreshed = await refreshGoogleToken(admin, connectorId, opts.refreshToken);
        if (refreshed) {
          token = refreshed;
        } else {
          await admin.from("sync_jobs").update({
            status: "failed",
            finished_at: now,
            progress_pct: 100,
            progress_step:
              "Google session expired and could not be renewed. Disconnect and reconnect from Platforms.",
            chunk_state: null,
          }).eq("id", jobId);
          return jsonResp({ status: "failed", error: "Google token expired and refresh failed." });
        }
      } else {
        await admin.from("sync_jobs").update({
          status: "failed",
          finished_at: now,
          progress_pct: 100,
          progress_step:
            "Google session has expired. Disconnect this workspace and reconnect from Platforms.",
          chunk_state: null,
        }).eq("id", jobId);
        return jsonResp({ status: "failed", error: "Google token expired. Please reconnect." });
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
    await updateProgress(5, "Listing your Google Sheets spreadsheets…");

    const g = (url: string, params?: Record<string, string>) =>
      googleGet(token, url, params, admin, connectorId, opts.refreshToken);

    // 1 — List all spreadsheets via Drive API
    const allFiles: Record<string, unknown>[] = [];
    let pageToken: string | undefined;
    while (timeLeft() > 8_000) {
      const params: Record<string, string> = {
        q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
        fields: "nextPageToken,files(id,name,modifiedTime,webViewLink)",
        pageSize: "100",
      };
      if (pageToken) params.pageToken = pageToken;

      let page: Record<string, unknown>;
      try {
        const res = await g(`${DRIVE_API}/files`, params);
        token = res.token; // keep refreshed token
        page = res.data;
      } catch (e) {
        return failJob(e instanceof Error ? e.message : "Failed to list Google Drive spreadsheets.");
      }

      const files = (page.files as Record<string, unknown>[]) ?? [];
      allFiles.push(...files);
      pageToken = page.nextPageToken as string | undefined;
      if (!pageToken) break;
    }

    if (allFiles.length === 0) {
      await admin.from("sync_jobs").update({
        status: "done",
        pages_synced: 0,
        finished_at: now,
        progress_pct: 100,
        progress_step: "No Google Sheets spreadsheets found.",
        chunk_state: null,
      }).eq("id", jobId);
      await admin.from("connectors").update({ last_synced_at: now }).eq("id", connectorId);
      return jsonResp({ status: "done", spreadsheets: 0, sheets: 0, rows: 0 });
    }

    let spreadsheetCount = 0;
    let sheetCount = 0;
    let rowCount = 0;

    for (const file of allFiles) {
      if (timeLeft() < 6_000) break;

      const fileId = String(file.id);
      const fileName = (file.name as string) ?? "Untitled";

      // Upsert spreadsheet record
      await admin.from("google_spreadsheets").upsert(
        {
          connector_id: connectorId,
          id: fileId,
          drive_file_id: fileId,
          name: fileName,
          last_modified_time: (file.modifiedTime as string) ?? null,
          web_view_link: (file.webViewLink as string) ?? null,
          synced_at: now,
        },
        { onConflict: "connector_id,id" },
      );
      spreadsheetCount++;

      await updateProgress(
        10 + Math.round((spreadsheetCount / allFiles.length) * 80),
        `Spreadsheet ${spreadsheetCount}/${allFiles.length}: ${fileName}`,
      );

      // 2 — Get spreadsheet metadata (sheets list)
      let spreadsheetMeta: Record<string, unknown>;
      try {
        const res = await g(`${SHEETS_API}/${fileId}`, { fields: "sheets(properties)" });
        token = res.token;
        spreadsheetMeta = res.data;
      } catch {
        continue;
      }

      const sheets = (
        (spreadsheetMeta.sheets as Array<{ properties: Record<string, unknown> }>) ?? []
      ).map((s) => s.properties);

      for (const sheetProps of sheets) {
        if (timeLeft() < 4_000) break;

        const sheetId = sheetProps.sheetId as number;
        const sheetTitle = (sheetProps.title as string) ?? "Sheet1";
        const gridProps = (sheetProps.gridProperties as Record<string, number>) ?? {};
        const compositeId = `${fileId}_${sheetId}`;

        await admin.from("google_sheets").upsert(
          {
            connector_id: connectorId,
            id: compositeId,
            spreadsheet_id: fileId,
            sheet_id: sheetId,
            title: sheetTitle,
            row_count: gridProps.rowCount ?? null,
            column_count: gridProps.columnCount ?? null,
            last_synced_at: now,
          },
          { onConflict: "connector_id,id" },
        );
        sheetCount++;

        // 3 — Fetch values (A1 notation: all cells)
        if (timeLeft() < 3_000) break;
        let valuesData: Record<string, unknown>;
        try {
          const range = encodeURIComponent(sheetTitle);
          const res = await g(
            `${SHEETS_API}/${fileId}/values/${range}`,
            { valueRenderOption: "FORMATTED_VALUE" },
          );
          token = res.token;
          valuesData = res.data;
        } catch {
          continue;
        }

        const rows = (valuesData.values as string[][]) ?? [];
        // Limit to first 1000 rows to stay within the chunk time budget
        const rowsToStore = rows.slice(0, 1_000);

        for (let i = 0; i < rowsToStore.length; i++) {
          if (timeLeft() < 2_000) break;
          await admin.from("google_sheet_rows").upsert(
            {
              connector_id: connectorId,
              id: `${compositeId}_${i}`,
              spreadsheet_id: fileId,
              sheet_id: sheetId,
              row_index: i,
              values_json: rowsToStore[i],
              synced_at: now,
            },
            { onConflict: "connector_id,id" },
          );
          rowCount++;
        }
      }
    }

    const totalSeen = spreadsheetCount + sheetCount + rowCount;
    await admin.from("sync_jobs").update({
      status: "done",
      pages_synced: totalSeen,
      finished_at: now,
      progress_pct: 100,
      progress_step: `${spreadsheetCount} spreadsheet${spreadsheetCount === 1 ? "" : "s"} · ${sheetCount} sheet${sheetCount === 1 ? "" : "s"} · ${rowCount} row${rowCount === 1 ? "" : "s"} backed up`,
      chunk_state: null,
    }).eq("id", jobId);

    await admin.from("connectors").update({ last_synced_at: now }).eq("id", connectorId);

    return jsonResp({
      status: "done",
      job_id: jobId,
      spreadsheets: spreadsheetCount,
      sheets: sheetCount,
      rows: rowCount,
    });
  } catch (err) {
    return failJob(err instanceof Error ? err.message : String(err));
  }
}
