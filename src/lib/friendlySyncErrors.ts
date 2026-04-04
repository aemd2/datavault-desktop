/**
 * Turn Supabase / network errors into short, actionable copy for backup flows.
 * Keep messages calm — avoid blame and internal jargon (RLS, PostgREST, etc.).
 */

function joinParts(err: unknown): { text: string; code: string } {
  if (err && typeof err === "object") {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    const text = [e.message, e.details, e.hint].filter(Boolean).join(" ").trim();
    return { text: text || String(err), code: (e.code ?? "").trim() };
  }
  return { text: String(err ?? ""), code: "" };
}

/** When "Sync Now" insert into sync_jobs fails. */
export function friendlyQueueSyncError(err: unknown): string {
  const { text, code } = joinParts(err);
  const lower = text.toLowerCase();

  if (!text || lower.includes("load failed") || lower.includes("failed to fetch") || lower.includes("network")) {
    return "We couldn’t reach the server. Check your internet connection, then try again.";
  }
  if (
    code === "PGRST301" ||
    lower.includes("jwt") ||
    lower.includes("permission denied") ||
    lower.includes("row-level security") ||
    lower.includes("rls")
  ) {
    return "Your session may have expired or this action isn’t allowed. Sign out, sign back in, and try again.";
  }
  if (lower.includes("duplicate") || lower.includes("unique") || lower.includes("already exists")) {
    return "A backup is already queued or running. Give it a moment — this page updates on its own.";
  }
  if (lower.includes("foreign key") || lower.includes("violates foreign key")) {
    return "This workspace link looks broken. Try reconnecting Notion from the dashboard.";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "The request took too long. Try again in a moment.";
  }
  if (lower.includes("column") && lower.includes("schema")) {
    return "The app is updating — refresh the page and try again. If this keeps happening, contact support.";
  }

  return "We couldn’t start the backup. Wait a few seconds, refresh the page, and try again.";
}

/** When the sync_jobs list fails to load. */
export function friendlySyncHistoryLoadError(err: unknown): string {
  const { text, code } = joinParts(err);
  const lower = text.toLowerCase();

  if (!text || lower.includes("failed to fetch") || lower.includes("network")) {
    return "We couldn’t load your backup history. Check your connection and refresh the page.";
  }
  if (code === "PGRST301" || lower.includes("jwt") || lower.includes("permission denied")) {
    return "We couldn’t load your backup history. Sign out and sign back in, then open the dashboard again.";
  }

  return "We couldn’t load your backup history. Refresh the page or try again shortly.";
}

/** When the connectors list fails to load. */
export function friendlyConnectorsLoadError(err: unknown): string {
  const { text, code } = joinParts(err);
  const lower = text.toLowerCase();

  if (!text || lower.includes("failed to fetch") || lower.includes("network")) {
    return "We couldn’t load your connected workspaces. Check your internet and refresh the page.";
  }
  if (code === "PGRST301" || lower.includes("jwt") || lower.includes("permission denied")) {
    return "We couldn’t load your workspaces. Sign out, sign back in, and return to the dashboard.";
  }

  return "We couldn’t load your workspaces. Refresh the page or try again in a moment.";
}

/** When a sync chunk fails (network or server error between chunks). */
export function friendlyChunkError(err: unknown): string {
  const { text } = joinParts(err);
  const lower = text.toLowerCase();

  if (lower.includes("not signed in") || lower.includes("sign in")) {
    return "Your session expired. Sign in again, then press Sync Now.";
  }
  if (!text || lower.includes("load failed") || lower.includes("failed to fetch") || lower.includes("network")) {
    return "We lost the connection during your backup. Check your internet — the backup will resume from where it stopped when you press Sync Now again.";
  }
  if (lower.includes("revoked") || lower.includes("reconnect notion")) {
    return "Notion access was revoked. Disconnect Notion on the dashboard, then reconnect it.";
  }
  if (lower.includes("rate-limit") || lower.includes("rate limit")) {
    return "Notion is rate-limiting us. Wait a minute or two, then try Sync Now again.";
  }
  if (lower.includes("notion") && lower.includes("trouble")) {
    return "Notion's servers seem to be having issues. Try again in a few minutes.";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "The backup timed out. Press Sync Now to resume from where it left off.";
  }

  return `Backup paused: ${text.slice(0, 120)}. Press Sync Now to try again.`;
}

/** When removing a connector (disconnect Notion) fails. */
export function friendlyDisconnectConnectorError(err: unknown): string {
  const { text, code } = joinParts(err);
  const lower = text.toLowerCase();

  if (!text || lower.includes("load failed") || lower.includes("failed to fetch") || lower.includes("network")) {
    return "We couldn’t reach the server. Check your connection, then try disconnecting again.";
  }
  if (
    code === "PGRST301" ||
    lower.includes("jwt") ||
    lower.includes("permission denied") ||
    lower.includes("row-level security") ||
    lower.includes("rls")
  ) {
    return "Your session may have expired, or you can’t remove this link. Sign out, sign back in, and try again.";
  }

  return "We couldn’t disconnect this workspace. Refresh the page and try again.";
}
