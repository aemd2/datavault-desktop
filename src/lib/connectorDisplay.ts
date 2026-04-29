import type { ConnectorKind } from "@/lib/connectorKinds";

const SYNC_KINDS: readonly ConnectorKind[] = [
  "notion",
  "trello",
  "todoist",
  "asana",
  "airtable",
  "google-sheets",
] as const;

/** Map `connectors.type` to the value run-sync expects; undefined if unknown. */
export function syncKindFromDbType(type: string): ConnectorKind | undefined {
  const t = type.toLowerCase();
  return (SYNC_KINDS as readonly string[]).includes(t) ? (t as ConnectorKind) : undefined;
}

/** Short label for badges and progress copy. */
export function friendlyConnectorLabel(type: string): string {
  switch (type.toLowerCase()) {
    case "notion":
      return "Notion";
    case "trello":
      return "Trello";
    case "todoist":
      return "Todoist";
    case "asana":
      return "Asana";
    case "airtable":
      return "Airtable";
    case "google-sheets":
      return "Google Sheets";
    case "obsidian":
      return "Obsidian";
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
}

/**
 * Obsidian is local-only — it has no Edge Function and no `run-sync` support.
 * The Dashboard card uses this check to swap "Sync Now" for a local rescan
 * and hide "Full re-sync".
 */
export function isLocalOnlyConnector(type: string): boolean {
  return type.toLowerCase() === "obsidian";
}

/** Back-compat name — same as {@link friendlyConnectorLabel}. */
export const friendlySourceLabel = friendlyConnectorLabel;

/**
 * Server progress strings are still often Notion-specific when the wrong kind
 * was sent earlier; normalize for display using the actual connector label.
 */
export function displayProgressStep(
  raw: string | null | undefined,
  sourceLabel: string,
  isPending: boolean,
): string {
  if (raw?.trim()) {
    return raw
      .replace(/\bNotion workspace\b/gi, `${sourceLabel} workspace`)
      .replace(/\bNotion\b/g, sourceLabel)
      .replace(/\bnotion\b/g, sourceLabel.toLowerCase());
  }
  return isPending ? "Starting your backup…" : `Working on your ${sourceLabel} backup…`;
}

/**
 * Turn `sync_jobs.progress_step` (often Notion-worded from the server) into copy
 * that matches the workspace card (Trello, Notion, …). Also normalizes leftover
 * "Notion" tokens via {@link displayProgressStep}.
 */
export function humanizeStoredSyncFailureMessage(
  raw: string | null | undefined,
  sourceLabel: string,
): string {
  if (!raw?.trim()) return "";
  let s = raw.trim();
  // Common run-sync templates that still say "Notion" for every connector kind.
  s = s.replace(/\bNotion access was revoked\b/gi, `${sourceLabel} access was revoked or expired`);
  s = s.replace(/\breconnect Notion on your dashboard\b/gi, `reconnect ${sourceLabel} from the Dashboard (disconnect this workspace, then add it again on Platforms)`);
  s = s.replace(/\bdisconnect and reconnect Notion\b/gi, `disconnect and reconnect ${sourceLabel}`);
  s = s.replace(/\bDisconnect Notion\b/g, `Disconnect ${sourceLabel}`);
  s = displayProgressStep(s, sourceLabel, false);

  // Server `progress_step` sometimes concatenates a connector-specific line with a generic
  // Notion-only paragraph. For Trello (etc.) we only want one voice in the summary line.
  if (sourceLabel.trim().toLowerCase() !== "notion") {
    const paragraphs = s
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const kept = paragraphs.filter((p) => {
      const lower = p.toLowerCase();
      if (lower.includes("notion access was revoked")) return false;
      if (lower.includes("reconnect notion")) return false;
      if (lower.includes("disconnect and reconnect notion")) return false;
      return true;
    });
    // If nothing survived (odd server text), keep the last pass so we do not blank the summary.
    s = kept.length > 0 ? kept.join("\n\n") : paragraphs.join("\n\n");
  }

  return s.trim();
}
