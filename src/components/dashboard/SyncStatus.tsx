import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SyncJobRow } from "@/hooks/useSyncJobs";
import { friendlySyncHistoryLoadError } from "@/lib/friendlySyncErrors";

interface SyncStatusProps {
  jobs: SyncJobRow[];
  isLoading: boolean;
  error: Error | null;
}

/** Map raw job status to a short, friendly label. */
function statusLabel(status: string): string {
  const s = status.toLowerCase();
  if (s === "done") return "Done";
  if (s === "running") return "Running";
  if (s === "failed") return "Couldn't finish";
  if (s === "pending") return "Queued";
  if (s === "cancelled") return "Stopped";
  return status;
}

/**
 * Recent backup runs — plain language for non-technical users.
 */
export const SyncStatus = ({ jobs, isLoading, error }: SyncStatusProps) => {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading recent backups…</p>;
  }
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-2">
        <p className="text-sm text-foreground font-medium">Couldn&apos;t load backup history</p>
        <p className="text-sm text-muted-foreground leading-relaxed">{friendlySyncHistoryLoadError(error)}</p>
      </div>
    );
  }
  if (jobs.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-muted/10 p-5 space-y-2">
        <p className="text-sm text-foreground font-medium">No backups yet</p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Press <strong className="text-foreground">Sync Now</strong> on a workspace card above. Finished runs will
          appear in this list.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
          <TableHead>Progress</TableHead>
          <TableHead>Items synced</TableHead>
          <TableHead>Started</TableHead>
          <TableHead>Finished</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((j) => (
          <TableRow key={j.id}>
            <TableCell className="align-top">
              <div className="font-medium">{statusLabel(j.status)}</div>
              {(j.status === "failed" || j.status === "cancelled") && j.progress_step ? (
                <p className="text-xs text-muted-foreground mt-1 max-w-[14rem] leading-snug">{j.progress_step}</p>
              ) : null}
            </TableCell>
            <TableCell className="text-muted-foreground text-xs">
              {j.status === "pending"
                ? "Not started"
                : j.status === "running"
                  ? `${j.progress_pct ?? 0}%`
                  : "—"}
            </TableCell>
            <TableCell>{j.pages_synced}</TableCell>
            <TableCell className="text-muted-foreground text-xs">
              {j.started_at ? new Date(j.started_at).toLocaleString() : "—"}
            </TableCell>
            <TableCell className="text-muted-foreground text-xs">
              {j.finished_at ? new Date(j.finished_at).toLocaleString() : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};
