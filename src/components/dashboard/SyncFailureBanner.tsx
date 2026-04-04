import type { SyncJobRow } from "@/hooks/useSyncJobs";

interface SyncFailureBannerProps {
  jobs: SyncJobRow[];
  connectorLabel: (connectorId: string) => string;
}

/**
 * If the most recent job failed, show a clear, non-technical recovery message.
 * Hidden when the latest row is pending/running/done (sorted by created_at desc).
 */
export function SyncFailureBanner({ jobs, connectorLabel }: SyncFailureBannerProps) {
  const latest = jobs[0];
  if (!latest || latest.status !== "failed") return null;

  const name = connectorLabel(latest.connector_id);
  const detail = latest.progress_step?.trim();

  return (
    <div
      className="rounded-xl border border-destructive/35 bg-destructive/5 p-4 space-y-3"
      role="alert"
      aria-live="polite"
    >
      <p className="text-sm font-medium text-foreground">
        Your last backup didn&apos;t finish — <span className="text-muted-foreground font-normal">{name}</span>
      </p>

      <p className="text-sm text-muted-foreground leading-relaxed">
        {detail && detail.length > 0
          ? detail
          : "Something went wrong while copying data from Notion. Often this is temporary or a connection hiccup."}
      </p>

      <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1.5 leading-relaxed">
        <li>Confirm Notion is available and you still have access to the pages you shared with DataVault.</li>
        <li>
          Try again in a little while: press <strong className="text-foreground">Sync Now</strong> on your workspace
          card.
        </li>
        <li>If backups keep failing, contact support (from your billing or plan page) and we&apos;ll dig in.</li>
      </ul>
    </div>
  );
}
