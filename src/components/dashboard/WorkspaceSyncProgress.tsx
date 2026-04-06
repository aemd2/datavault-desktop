import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { SyncJobRow } from "@/hooks/useSyncJobs";
import { useCancelSyncJob } from "@/hooks/useCancelSyncJob";
import { minutesSince } from "@/lib/pickSyncJobForUI";

interface WorkspaceSyncProgressProps {
  job: SyncJobRow;
  /** How many other pending/running jobs exist (for a short queue hint). */
  otherActiveBackupCount: number;
}

function useElapsedLabel(iso: string | null): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!iso) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [iso]);

  if (!iso) return "";
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

/**
 * Estimate time remaining based on elapsed time and progress percentage.
 * Only returns a value once pct >= 10 so early wild estimates are avoided.
 * Re-renders every second via the same tick pattern as useElapsedLabel.
 */
function useTimeRemaining(startedIso: string | null, pct: number): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!startedIso || pct < 10) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1_000);
    return () => window.clearInterval(id);
  }, [startedIso, pct >= 10]);

  if (!startedIso || pct < 10) return "";

  const elapsedMs = Date.now() - new Date(startedIso).getTime();
  if (elapsedMs <= 0) return "";

  const totalEstimateSec = (elapsedMs / 1_000) / (pct / 100);
  const remainingSec = Math.max(0, totalEstimateSec - elapsedMs / 1_000);

  if (remainingSec < 60) return "Less than a minute remaining";
  const mins = Math.ceil(remainingSec / 60);
  return `About ${mins} min remaining`;
}

/** Pulsing bar while queued — reads as “waiting”, not a percent. */
function QueueWaitingBar() {
  return (
    <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
      <div className="h-full w-full rounded-full bg-primary/70 animate-queue-wait-pulse" />
    </div>
  );
}

/**
 * Single backup progress block for one workspace card (bar, timer, stop, hints).
 * Keeps the dashboard from showing two progress UIs for the same run.
 */
export function WorkspaceSyncProgress({ job, otherActiveBackupCount }: WorkspaceSyncProgressProps) {
  const { mutate: cancelJob, isPending: cancelling } = useCancelSyncJob();
  const [stopOpen, setStopOpen] = useState(false);

  const startedAt = (job.status === "running" ? job.started_at : null) ?? job.created_at;
  const elapsed = useElapsedLabel(startedAt);

  const isPending = job.status === "pending";
  const pct = job.progress_pct ?? 0;
  const remaining = useTimeRemaining(isPending ? null : startedAt, pct);
  const step =
    job.progress_step || (isPending ? "Starting your backup…" : "Working on your Notion backup…");

  const stuckPending = isPending && minutesSince(job.created_at) >= 8;
  const stuckRunning = !isPending && minutesSince(job.started_at) >= 45;

  return (
    <div
      className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2.5"
      role="status"
      aria-live="polite"
      aria-label="Backup progress for this workspace"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">
          {isPending ? "Backup queued" : "Backup in progress"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {elapsed ? (
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {isPending ? "Waiting" : "Elapsed"}: <span className="text-foreground">{elapsed}</span>
            </p>
          ) : null}
          <AlertDialog open={stopOpen} onOpenChange={setStopOpen}>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 text-[11px] px-2" disabled={cancelling}>
                Stop backup
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Stop this backup?</AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  <span className="block">
                    {isPending
                      ? "This run will be removed from the queue. Nothing has been copied yet for this job."
                      : "We will stop after the current step. Pages already saved stay in your backup; the rest can be added later with Sync Now."}
                  </span>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={cancelling}>Keep going</AlertDialogCancel>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={cancelling}
                  onClick={() =>
                    cancelJob(job.id, {
                      onSuccess: () => setStopOpen(false),
                      onError: () => setStopOpen(false),
                    })
                  }
                >
                  {cancelling ? "Stopping…" : "Stop backup"}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {isPending ? <QueueWaitingBar /> : <Progress value={Math.min(100, Math.max(0, pct))} className="h-2" />}

      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-[11px] text-muted-foreground leading-relaxed">{step}</p>
        {remaining ? (
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed whitespace-nowrap">
            {remaining}
          </p>
        ) : null}
      </div>

      {stuckPending ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-100/90 leading-relaxed">
          <p className="font-medium text-amber-50">Still waiting a long time?</p>
          <p className="mt-0.5 text-amber-100/80">
            Try <strong className="text-amber-50">Sync Now</strong> again after a minute or two, or contact support if
            it never starts.
          </p>
        </div>
      ) : null}

      {stuckRunning ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-100/90 leading-relaxed">
          <p className="font-medium text-amber-50">Unusually long run</p>
          <p className="mt-0.5 text-amber-100/80">
            Large workspaces copy in chunks — many minutes can be normal. If the percentage stalls for a very long time,
            try <strong className="text-amber-50">Sync Now</strong> again or reach out for help.
          </p>
        </div>
      ) : null}

      {isPending ? (
        <p className="text-[10px] text-muted-foreground border-t border-border/40 pt-2 leading-relaxed">
          This page refreshes on its own — no need to reload. If you already pressed Sync Now, just wait.
        </p>
      ) : null}

      {otherActiveBackupCount > 0 ? (
        <p className="text-[10px] text-muted-foreground">
          {otherActiveBackupCount} other active backup{otherActiveBackupCount > 1 ? "s" : ""} in your account — only
          one runs at a time.
        </p>
      ) : null}
    </div>
  );
}
