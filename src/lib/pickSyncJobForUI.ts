import type { SyncJobRow } from "@/hooks/useSyncJobs";

/**
 * Pick the one job that best represents “what’s going on” for a workspace card.
 * Prefer an in-flight run (running) over a queued row (pending) so the UI matches reality.
 */
/** Jobs that still block Sync Now or show the progress banner. */
const ACTIVE_STATUSES = new Set(["pending", "running"]);

export function pickRelevantSyncJobForConnector(jobs: SyncJobRow[], connectorId: string): SyncJobRow | undefined {
  const mine = jobs.filter((j) => j.connector_id === connectorId && ACTIVE_STATUSES.has(j.status));
  if (!mine.length) return undefined;

  const running = mine
    .filter((j) => j.status === "running")
    .sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""));
  if (running.length) return running[0];

  const pending = mine
    .filter((j) => j.status === "pending")
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return pending[0];
}

/**
 * Dashboard banner: show the run that is actually executing if any; otherwise the next pending (FIFO).
 */
export function pickBannerSyncJob(jobs: SyncJobRow[]): SyncJobRow | undefined {
  const active = jobs.filter((j) => ACTIVE_STATUSES.has(j.status));
  if (!active.length) return undefined;

  const running = active
    .filter((j) => j.status === "running")
    .sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""));
  if (running.length) return running[0];

  const pending = active
    .filter((j) => j.status === "pending")
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return pending[0];
}

export function countActiveSyncJobs(jobs: SyncJobRow[]): number {
  return jobs.filter((j) => ACTIVE_STATUSES.has(j.status)).length;
}

/** Minutes since ISO timestamp (for stuck detection). */
export function minutesSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 60_000);
}
