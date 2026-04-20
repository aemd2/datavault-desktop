import type { SyncJobRow } from "@/hooks/useSyncJobs";
import { humanizeStoredSyncFailureMessage } from "@/lib/connectorDisplay";

interface SyncFailureBannerProps {
  jobs: SyncJobRow[];
  /** Workspace title shown on the card (e.g. "Trello"). */
  connectorLabel: (connectorId: string) => string;
  /**
   * Integration name for error copy (e.g. "Trello", "Notion").
   * Optional so a stale HMR bundle or older caller cannot crash the dashboard.
   */
  connectorSourceLabel?: (connectorId: string) => string;
}

/**
 * If the most recent job failed, show a clear, non-technical recovery message.
 * Hidden when the latest row is pending/running/done (sorted by created_at desc).
 */
export function SyncFailureBanner({ jobs, connectorLabel, connectorSourceLabel }: SyncFailureBannerProps) {
  const latest = jobs[0];
  if (!latest || latest.status !== "failed") return null;

  const name = connectorLabel(latest.connector_id);
  // Fall back to workspace title when the prop is missing (undefined during fast refresh).
  const source =
    typeof connectorSourceLabel === "function"
      ? connectorSourceLabel(latest.connector_id)
      : name;
  const rawDetail = latest.progress_step?.trim() ?? "";
  const friendlyDetail = humanizeStoredSyncFailureMessage(rawDetail, source);
  const summary =
    friendlyDetail ||
    rawDetail ||
    "Something went wrong while copying data. Often this is temporary — try Sync again in a minute.";

  return (
    <div
      className="rounded-xl border border-destructive/35 bg-destructive/5 p-4 space-y-3"
      role="alert"
      aria-live="polite"
    >
      <p className="text-sm font-medium text-foreground">
        Your last backup didn&apos;t finish —{" "}
        <span className="text-muted-foreground font-normal">
          {name}
          {name.trim().toLowerCase() !== source.trim().toLowerCase() ? ` (${source})` : ""}
        </span>
      </p>

      <p className="text-sm text-muted-foreground leading-relaxed">{summary}</p>

      {rawDetail ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none text-foreground/80 hover:text-foreground">
            Raw server message (for troubleshooting)
          </summary>
          <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/50 bg-background/90 p-2 font-mono text-[11px] leading-snug text-foreground/90">
            {rawDetail}
          </pre>
        </details>
      ) : null}

      <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1.5 leading-relaxed">
        <li>
          Confirm <strong className="text-foreground">{source}</strong> is reachable and you still have access to the
          data you shared with DataVault.
        </li>
        <li>
          Try again: press <strong className="text-foreground">Sync Now</strong> on this workspace card. If access was
          revoked, disconnect here and reconnect from <strong className="text-foreground">Platforms</strong>.
        </li>
        <li>If backups keep failing, contact support (from your billing or plan page) and we&apos;ll dig in.</li>
      </ul>
    </div>
  );
}
