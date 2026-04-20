import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase";
import { friendlyQueueSyncError, friendlyChunkError } from "@/lib/friendlySyncErrors";
import type { ConnectorKind } from "@/lib/connectorKinds";

const RUN_SYNC_URL = `${SUPABASE_URL}/functions/v1/run-sync`;

/** Backoff schedule for network retries between chunks (ms). */
const CHUNK_RETRY_DELAYS = [3_000, 6_000, 10_000];

/** Pause between successful chunks (ms). Keep short on free tier. */
const INTER_CHUNK_PAUSE_MS = 2_000;

/** Max consecutive network failures before giving up the chain. */
const MAX_CHUNK_RETRIES = 3;

// ── Types ──────────────────────────────────────────────────────────────────

interface ChunkResponse {
  status: "done" | "needs_more" | "failed" | "already_running" | "cancelled" | "no_pending";
  job_id?: string;
  connector_id?: string;
  cursor?: string;
  page_count?: number;
  db_count?: number;
  row_count?: number;
  skip_count?: number;
  comment_count?: number;
  seen_page_ids?: string[];
  seen_db_ids?: string[];
  force?: boolean;
  total_items?: number;
  count_complete?: boolean;
  users_fetched?: boolean;
  error?: string;
  pages?: number;
  databases?: number;
  rows?: number;
  skipped?: number;
  comments?: number;
  /** True when run-sync is in local-first vault mode (DATAVAULT_STORE_FULL_PAYLOAD=false).
   *  Page bodies are in Storage, not in notion_pages.raw_json. */
  vault_pages_in_storage?: boolean;
  /** Echoed back so the client can forward on the next chunk. */
  connector_kind?: ConnectorKind;
  /** Opaque per-connector resume state returned by the Edge Function. */
  kind_state?: Record<string, unknown>;
}

interface ChunkParams {
  connector_id: string;
  /** Which platform this connector belongs to. Defaults to "notion" on the server. */
  connector_kind?: ConnectorKind;
  job_id?: string;
  cursor?: string;
  page_count?: number;
  db_count?: number;
  row_count?: number;
  skip_count?: number;
  comment_count?: number;
  seen_page_ids?: string[];
  seen_db_ids?: string[];
  force?: boolean;
  total_items?: number;
  count_complete?: boolean;
  users_fetched?: boolean;
  /** Opaque per-connector resume state (Trello/Asana/etc. pack their cursor here). */
  kind_state?: Record<string, unknown>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fire one chunk of the run-sync Edge Function.
 * Returns the parsed JSON response, or throws on network failure.
 */
async function fireChunk(params: ChunkParams): Promise<ChunkResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const jwt = sessionData.session?.access_token;
  if (!jwt) throw new Error("Not signed in — please sign in and try again.");

  // Supabase's API gateway expects `apikey` (anon key) on browser calls. Without it,
  // the OPTIONS preflight or POST can fail with CORS / net::ERR_FAILED from localhost.
  const resp = await fetch(RUN_SYNC_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error ?? `Server error (${resp.status})`);
  }

  return resp.json();
}

/**
 * Fire the first chunk, then chain follow-up chunks until the Edge Function
 * reports "done" or "failed". Retries transient network errors up to 3 times.
 * Pass force=true to bypass skip-if-unchanged and re-copy everything.
 */
async function runSyncChain(
  connectorId: string,
  queryClient: ReturnType<typeof useQueryClient>,
  force = false,
  kind?: ConnectorKind,
) {
  let params: ChunkParams = {
    connector_id: connectorId,
    connector_kind: kind,
    force: force || undefined,
  };
  let consecutiveNetworkErrors = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let result: ChunkResponse;

    try {
      result = await fireChunk(params);
      consecutiveNetworkErrors = 0;
    } catch (err) {
      consecutiveNetworkErrors++;
      if (consecutiveNetworkErrors > MAX_CHUNK_RETRIES) {
        toast.error(friendlyChunkError(err, kind), { duration: 10_000 });
        return;
      }
      // Wait and retry with the same params (the Edge Function saved progress).
      const delay = CHUNK_RETRY_DELAYS[consecutiveNetworkErrors - 1] ?? 10_000;
      await sleep(delay);
      continue;
    }

    if (result.status === "done") {
      queryClient.invalidateQueries({ queryKey: ["sync_jobs"] });
      queryClient.invalidateQueries({ queryKey: ["notion-pages"] });
      queryClient.invalidateQueries({ queryKey: ["notion-databases"] });
      queryClient.invalidateQueries({ queryKey: ["notion-comments"] });
      queryClient.invalidateQueries({ queryKey: ["trello-boards"] });
      queryClient.invalidateQueries({ queryKey: ["trello-cards"] });
      if (result.connector_kind === "trello") {
        const c = result.pages ?? 0;
        const l = result.databases ?? 0;
        const b = result.rows ?? 0;
        // Updated toast reflects the rich data now downloaded (checklists, attachments, labels, members)
        toast.success(`Trello backup complete — ${c} cards (with checklists & attachments), ${l} lists, ${b} boards.`, { duration: 8_000 });
        return;
      }
      const parts = [
        result.pages ? `${result.pages} pages` : null,
        result.databases ? `${result.databases} tables` : null,
        result.rows ? `${result.rows} rows` : null,
        result.skipped ? `${result.skipped} unchanged` : null,
      ].filter(Boolean).join(", ");
      const baseMsg = parts ? `Backup complete — ${parts}.` : "Backup complete.";
      // In local-first vault mode, nudge users to download their vault.
      const extra = result.vault_pages_in_storage
        ? " Your page text is in your vault — press Download backup to get the ZIP."
        : "";
      toast.success(`${baseMsg}${extra}`, { duration: result.vault_pages_in_storage ? 10_000 : 6_000 });
      return;
    }

    if (result.status === "failed") {
      queryClient.invalidateQueries({ queryKey: ["sync_jobs"] });
      const failKind = result.connector_kind ?? kind;
      const raw = result.error ?? "Backup failed — try again later.";
      toast.error(friendlyChunkError(raw, failKind), { duration: 12_000 });
      return;
    }

    if (result.status === "cancelled") {
      queryClient.invalidateQueries({ queryKey: ["sync_jobs"] });
      return;
    }

    if (result.status === "no_pending") {
      queryClient.invalidateQueries({ queryKey: ["sync_jobs"] });
      return;
    }

    if (result.status === "already_running") {
      return;
    }

    // "needs_more" — wait, then fire next chunk with continuation params.
    if (result.status === "needs_more") {
      queryClient.invalidateQueries({ queryKey: ["sync_jobs"] });
      await sleep(INTER_CHUNK_PAUSE_MS);
      params = {
        connector_id: result.connector_id ?? connectorId,
        connector_kind: result.connector_kind ?? kind,
        job_id: result.job_id,
        cursor: result.cursor,
        page_count: result.page_count,
        db_count: result.db_count,
        row_count: result.row_count,
        skip_count: result.skip_count,
        comment_count: result.comment_count,
        seen_page_ids: result.seen_page_ids,
        seen_db_ids: result.seen_db_ids,
        force: result.force || undefined,
        total_items: result.total_items,
        count_complete: result.count_complete,
        users_fetched: result.users_fetched,
        kind_state: result.kind_state,
      };
      continue;
    }

    // Unexpected status — treat as done.
    return;
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────

/** Argument for the startSync mutation. */
export interface StartSyncArgs {
  connectorId: string;
  /** When true, re-fetch everything — ignore skip-if-unchanged optimization. */
  force?: boolean;
  /** Which platform this connector belongs to. Defaults to Notion on the server. */
  kind?: ConnectorKind;
}

/**
 * Trigger a manual sync for a connector.
 * Inserts a pending sync_jobs row, then kicks the first chunk.
 * The chain runs in the background — the mutation resolves immediately.
 */
export function useStartSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ connectorId, force = false, kind }: StartSyncArgs) => {
      // One pending row per connector.
      const { count, error: countError } = await supabase
        .from("sync_jobs")
        .select("*", { count: "exact", head: true })
        .eq("connector_id", connectorId)
        .eq("status", "pending");

      if (countError) throw countError;
      if (count != null && count > 0) {
        runSyncChain(connectorId, queryClient, force, kind);
        return { skipped: true as const, connectorId };
      }

      const { count: runningCount, error: runErr } = await supabase
        .from("sync_jobs")
        .select("*", { count: "exact", head: true })
        .eq("connector_id", connectorId)
        .eq("status", "running");

      if (!runErr && runningCount != null && runningCount > 0) {
        // Kick the chain even for running jobs — the Edge Function will
        // resume from saved chunk_state (handles tab-close mid-sync).
        runSyncChain(connectorId, queryClient, force, kind);
        return { skipped: true as const, connectorId };
      }

      const { error } = await supabase
        .from("sync_jobs")
        .insert({ connector_id: connectorId, status: "pending" });

      if (error) throw error;

      runSyncChain(connectorId, queryClient, force, kind);

      return { skipped: false as const, connectorId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["sync_jobs"] });
      if (data.skipped) {
        toast.message(
          "A backup is already queued or running for this workspace. This page updates on its own.",
          { duration: 9000 },
        );
        return;
      }
      toast.success("Backup started. You can leave this page — progress will show up here.", {
        duration: 6500,
      });
    },
    onError: (err, variables) => {
      toast.error(friendlyQueueSyncError(err, variables?.kind), { duration: 10_000 });
    },
  });
}
