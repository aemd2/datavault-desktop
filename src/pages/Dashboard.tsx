import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase, SUPABASE_URL } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AuthGuard } from "@/components/AuthGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ConnectorCard } from "@/components/dashboard/ConnectorCard";
import { SyncFailureBanner } from "@/components/dashboard/SyncFailureBanner";
import { SyncStatus } from "@/components/dashboard/SyncStatus";
import { friendlyConnectorsLoadError } from "@/lib/friendlySyncErrors";
import { countActiveSyncJobs, pickRelevantSyncJobForConnector } from "@/lib/pickSyncJobForUI";
import { useClearPendingSyncJobs } from "@/hooks/useClearPendingSyncJobs";
import { useConnectors } from "@/hooks/useConnectors";
import { useSyncJobs } from "@/hooks/useSyncJobs";
import { useSubscription } from "@/hooks/useSubscription";

/**
 * Supabase Edge Function base URL for OAuth initiation.
 * The Edge Function reads the user JWT from Authorization header.
 */

/** Plan label people understand at a glance. */
function planDisplayName(plan: string): string {
  const p = plan.toLowerCase();
  if (p === "free") return "Free plan";
  if (p === "managed") return "Managed";
  if (p === "enterprise") return "Enterprise";
  return plan;
}

/** Colour by tier — outline for free, stronger for paid. */
function PlanBadge({ plan }: { plan: string }) {
  const variants: Record<string, "default" | "secondary" | "outline"> = {
    free: "outline",
    managed: "secondary",
    enterprise: "default",
  };
  return (
    <Badge variant={variants[plan.toLowerCase()] ?? "outline"} className="capitalize">
      {planDisplayName(plan)}
    </Badge>
  );
}

/** Triggers Notion OAuth: fetches session JWT then opens the OAuth URL.
 *  In Electron, uses shell.openExternal so the system browser handles the flow.
 *  On web, it's a normal navigation. */
async function startNotionOAuth() {
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt) return;
  // Pass the JWT as ?token= so the Edge Function can encode it as OAuth state.
  const oauthUrl = `${SUPABASE_URL}/functions/v1/notion-oauth?action=start&token=${encodeURIComponent(jwt)}`;

  const isElectron = typeof window !== "undefined" && "electronAPI" in window;
  if (isElectron && window.electronAPI?.openExternal) {
    // Open in system browser; user returns to the app after authorizing.
    // The connector is stored in Supabase and will appear on next poll.
    toast.message("Notion is opening in your browser", {
      description: "Authorize access, then come back here — your workspace will appear automatically.",
      duration: 8000,
    });
    await window.electronAPI.openExternal(oauthUrl);
  } else {
    window.location.href = oauthUrl;
  }
}

/**
 * Main app shell after login: connectors + recent sync jobs.
 */
const DashboardInner = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: connectors = [], isLoading: loadingConn, error: connError } = useConnectors();
  const ids = connectors.map((c) => c.id);
  const { data: jobs = [], isLoading: loadingJobs, error: jobsError } = useSyncJobs(ids);
  const { data: subscription } = useSubscription();
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

  const isElectronApp = typeof window !== "undefined" && "electronAPI" in window;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    // Electron: go to login (there's no landing page). Web: go to home.
    navigate(isElectronApp ? "/login" : "/", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/80 bg-card/30">
        <div className="max-w-4xl mx-auto px-6 py-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="font-display text-xl font-bold">
                <span className="text-foreground">Data</span>
                <span className="text-gradient-gold">Vault</span>
              </h1>
              <p className="text-xs text-muted-foreground">Your backup &amp; workspaces</p>
            </div>
            {subscription && <PlanBadge plan={subscription.plan} />}
          </div>

          {/* flex-wrap keeps buttons usable on small screens */}
          <div className="flex flex-wrap gap-2">
            {/* Electron has no landing page — Dashboard IS home */}
            {!isElectronApp && (
              <Button variant="outline" size="sm" onClick={() => navigate("/")}>
                Home
              </Button>
            )}
            <Button variant="default" size="sm" onClick={() => navigate("/viewer")}>
              Browse backup
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/billing")}>
              Billing
            </Button>
            <Button variant="secondary" size="sm" onClick={handleLogout}>
              Log out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-10">
        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Connected workspaces</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Link Notion once, then use <strong className="text-foreground">Sync Now</strong> anytime to refresh
                your backup.
              </p>
            </div>
            <Button size="sm" className="shrink-0" onClick={startNotionOAuth}>
              + Connect Notion
            </Button>
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
              <p className="text-sm text-foreground font-medium">Connect Notion to get started</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Press <strong className="text-foreground">+ Connect Notion</strong> and approve access. That&apos;s
                it — no copying tokens by hand.
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/50 pt-3">
                <span className="font-medium text-foreground">Setting up the app?</span> Your developer needs
                Notion OAuth keys in Supabase (Edge Function secrets). See{" "}
                <code className="text-foreground">supabase/functions/README.md</code>.
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

        <SyncFailureBanner jobs={jobs} connectorLabel={connectorLabel} />

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
            <SyncStatus jobs={jobs} isLoading={loadingJobs} error={jobsError as Error | null} />
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
