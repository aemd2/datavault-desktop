import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { AuthGuard } from "@/components/AuthGuard";
import { AppTopNav } from "@/components/AppTopNav";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ConnectorCard } from "@/components/dashboard/ConnectorCard";
import { SyncFailureBanner } from "@/components/dashboard/SyncFailureBanner";
import { SyncStatus } from "@/components/dashboard/SyncStatus";
import { friendlyConnectorsLoadError } from "@/lib/friendlySyncErrors";
import { countActiveSyncJobs, pickRelevantSyncJobForConnector } from "@/lib/pickSyncJobForUI";
import { useClearPendingSyncJobs } from "@/hooks/useClearPendingSyncJobs";
import { useConnectors } from "@/hooks/useConnectors";
import { useSyncJobs } from "@/hooks/useSyncJobs";
import { friendlyConnectorLabel } from "@/lib/connectorDisplay";
import { startNotionOAuth } from "@/lib/startNotionOAuth";

/**
 * Main app shell after login: connectors + recent sync jobs.
 */
const DashboardInner = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: connectors = [], isLoading: loadingConn, error: connError } = useConnectors();
  const ids = connectors.map((c) => c.id);
  const { data: jobs = [], isLoading: loadingJobs, error: jobsError } = useSyncJobs(ids);
  const { mutate: clearPendingJobs, isPending: clearingPending } = useClearPendingSyncJobs();
  const pendingRowCount = useMemo(() => jobs.filter((j) => j.status === "pending").length, [jobs]);
  const activeBackupTotal = useMemo(() => countActiveSyncJobs(jobs), [jobs]);

  // In Electron, refresh connectors when the app window regains focus.
  // This picks up newly-connected workspaces after the OAuth browser flow.
  useEffect(() => {
    const isElectron = typeof window !== "undefined" && "electronAPI" in window;
    if (!isElectron) return;

    const onFocus = () => {
      void queryClient.invalidateQueries({ queryKey: ["connectors"] });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [queryClient]);

  // In Electron, poll for new connectors when none exist yet (user is completing OAuth in browser).
  // Stops polling once a connector appears or on non-Electron platforms.
  useEffect(() => {
    const isElectron = typeof window !== "undefined" && "electronAPI" in window;
    if (!isElectron || connectors.length > 0) return;

    const id = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["connectors"] });
    }, 3_000);
    return () => window.clearInterval(id);
  }, [connectors.length, queryClient]);

  const connectorLabel = (connectorId: string) =>
    connectors.find((c) => c.id === connectorId)?.workspace_name ?? "Your workspace";

  /** Notion/Trello/… — used to fix server error strings that still say "Notion". */
  const connectorSourceLabel = (connectorId: string) => {
    const row = connectors.find((c) => c.id === connectorId);
    return row ? friendlyConnectorLabel(row.type) : "Connected source";
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppTopNav active="dashboard" />

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-10">
        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Connected workspaces</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Add accounts on <strong className="text-foreground">Platforms</strong>, then use{" "}
                <strong className="text-foreground">Sync Now</strong> here to refresh each backup.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0 justify-end">
              <Button size="sm" variant="outline" onClick={() => navigate("/platforms")}>
                + Add connection
              </Button>
              <Button size="sm" onClick={startNotionOAuth}>
                + Connect Notion
              </Button>
            </div>
          </div>

          {loadingConn && <p className="text-sm text-muted-foreground">Loading your workspaces…</p>}
          {connError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-2">
              <p className="text-sm font-medium text-foreground">Something went wrong loading your workspaces</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {friendlyConnectorsLoadError(connError)}
              </p>
            </div>
          )}
          {!loadingConn && connectors.length === 0 && (
            <div className="rounded-xl border border-border/60 bg-muted/10 p-6 space-y-3 max-w-xl">
              <p className="text-sm text-foreground font-medium">Connect a source to get started</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Open <strong className="text-foreground">Platforms</strong> to link Notion, Trello, and more — or use{" "}
                <strong className="text-foreground">+ Connect Notion</strong> above for a quick Notion-only setup.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="default" onClick={() => navigate("/platforms")}>
                  Go to Platforms
                </Button>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/50 pt-3">
                <span className="font-medium text-foreground">Setting up the app?</span> OAuth keys live in Supabase
                Edge Function secrets. See <code className="text-foreground">supabase/functions/README.md</code>.
              </p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {connectors.map((c) => {
              const mine = pickRelevantSyncJobForConnector(jobs, c.id);
              return (
                <ConnectorCard
                  key={c.id}
                  connector={c}
                  activeSyncJob={mine}
                  otherActiveBackupCount={mine ? Math.max(0, activeBackupTotal - 1) : 0}
                />
              );
            })}
          </div>
        </section>

        <SyncFailureBanner
          jobs={jobs}
          connectorLabel={connectorLabel}
          connectorSourceLabel={connectorSourceLabel}
        />

        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Recent backups</h2>
              <p className="text-sm text-muted-foreground">
                Status of each backup: running, done, stopped, or couldn&apos;t finish.{" "}
                <strong className="text-foreground">Waiting</strong> means your backup is in line to start — not an error. Use{" "}
                <strong className="text-foreground">Stop backup</strong> on the workspace card if you need to cancel. The list updates
                automatically.
              </p>
            </div>
            {pendingRowCount > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={clearingPending || ids.length === 0}
                title="Deletes only pending rows you own. Done and failed history is kept."
                onClick={() => clearPendingJobs(ids)}
              >
                {clearingPending ? "Removing…" : `Clear ${pendingRowCount} waiting ${pendingRowCount === 1 ? "row" : "rows"}`}
              </Button>
            ) : null}
          </div>
          <ErrorBoundary componentName="SyncStatus">
            <SyncStatus
              jobs={jobs}
              isLoading={loadingJobs}
              error={jobsError as Error | null}
              connectorSourceLabel={connectorSourceLabel}
            />
          </ErrorBoundary>
        </section>
      </main>
    </div>
  );
};

/** Exported page wrapped in AuthGuard for routing. */
const Dashboard = () => (
  <AuthGuard>
    <DashboardInner />
  </AuthGuard>
);

export default Dashboard;
