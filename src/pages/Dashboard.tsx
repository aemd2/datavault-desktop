import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Shield, Layers } from "lucide-react";
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

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

const DashboardInner = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: connectors = [], isLoading: loadingConn, error: connError } = useConnectors();
  const ids = connectors.map((c) => c.id);
  const { data: jobs = [], isLoading: loadingJobs, error: jobsError } = useSyncJobs(ids);
  const { mutate: clearPendingJobs, isPending: clearingPending } = useClearPendingSyncJobs();
  const pendingRowCount = useMemo(() => jobs.filter((j) => j.status === "pending").length, [jobs]);
  const activeBackupTotal = useMemo(() => countActiveSyncJobs(jobs), [jobs]);

  // Refresh connectors when Electron window regains focus (post-OAuth callback).
  useEffect(() => {
    const isElectron = typeof window !== "undefined" && "electronAPI" in window;
    if (!isElectron) return;
    const onFocus = () => void queryClient.invalidateQueries({ queryKey: ["connectors"] });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [queryClient]);

  // Poll when no connectors exist yet (Electron OAuth in progress).
  useEffect(() => {
    const isElectron = typeof window !== "undefined" && "electronAPI" in window;
    if (!isElectron || connectors.length > 0) return;
    const id = window.setInterval(() => void queryClient.invalidateQueries({ queryKey: ["connectors"] }), 3_000);
    return () => window.clearInterval(id);
  }, [connectors.length, queryClient]);

  const connectorLabel = (connectorId: string) =>
    connectors.find((c) => c.id === connectorId)?.workspace_name ?? "Your workspace";

  const connectorSourceLabel = (connectorId: string) => {
    const row = connectors.find((c) => c.id === connectorId);
    return row ? friendlyConnectorLabel(row.type) : "Connected source";
  };

  const lastSync = useMemo(() => {
    const dates = connectors
      .map((c) => c.last_synced_at)
      .filter(Boolean)
      .map((d) => new Date(d!).getTime());
    if (!dates.length) return null;
    return new Date(Math.max(...dates));
  }, [connectors]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppTopNav active="dashboard" />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* Page header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Your Vault</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {loadingConn
                ? "Loading your workspaces…"
                : connectors.length > 0
                  ? `${connectors.length} workspace${connectors.length !== 1 ? "s" : ""} connected${lastSync ? ` · Last backup ${relativeTime(lastSync)}` : ""}`
                  : "Connect a platform to start protecting your data"}
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => navigate("/platforms")}
            className="shrink-0 self-start sm:self-auto"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Add connection
          </Button>
        </div>

        {/* Error loading connectors */}
        {connError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-1">
            <p className="text-sm font-medium">Couldn't load your workspaces</p>
            <p className="text-sm text-muted-foreground">{friendlyConnectorsLoadError(connError)}</p>
          </div>
        )}

        {/* Empty state */}
        {!loadingConn && connectors.length === 0 && !connError && (
          <div className="rounded-2xl border border-border/60 bg-muted/10 px-6 py-14 flex flex-col items-center text-center gap-5">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Shield className="w-7 h-7 text-primary" />
            </div>
            <div className="space-y-2 max-w-sm">
              <h2 className="text-base font-semibold">No workspaces connected yet</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Connect Notion, Airtable, Trello, and more. DataVault keeps a local copy of everything — so your data
                is yours, always.
              </p>
            </div>
            <Button onClick={() => navigate("/platforms")}>
              <Layers className="w-4 h-4 mr-1.5" />
              Browse platforms
            </Button>
          </div>
        )}

        {/* Skeleton while loading */}
        {loadingConn && (
          <div className="grid gap-4 sm:grid-cols-2">
            {[1, 2].map((n) => (
              <div key={n} className="rounded-xl border border-border/60 bg-card/50 h-44 animate-pulse" />
            ))}
          </div>
        )}

        {/* Connector cards */}
        {connectors.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Connected workspaces
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
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
        )}

        <SyncFailureBanner
          jobs={jobs}
          connectorLabel={connectorLabel}
          connectorSourceLabel={connectorSourceLabel}
        />

        {/* Recent backups */}
        <section className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Recent backups</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                <span className="font-medium text-foreground">Queued</span> means waiting to start — not an error.
                Use <span className="font-medium text-foreground">Stop backup</span> on a card to cancel.
              </p>
            </div>
            {pendingRowCount > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 self-start sm:self-auto"
                disabled={clearingPending || ids.length === 0}
                title="Removes only pending rows you own. Done and failed history is kept."
                onClick={() => clearPendingJobs(ids)}
              >
                {clearingPending ? "Removing…" : `Clear ${pendingRowCount} queued`}
              </Button>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-border/60">
            <ErrorBoundary componentName="SyncStatus">
              <SyncStatus
                jobs={jobs}
                isLoading={loadingJobs}
                error={jobsError as Error | null}
                connectorSourceLabel={connectorSourceLabel}
              />
            </ErrorBoundary>
          </div>
        </section>

      </main>
    </div>
  );
};

const Dashboard = () => (
  <AuthGuard>
    <DashboardInner />
  </AuthGuard>
);

export default Dashboard;
