import { useId, useState } from "react";
import { Link, Outlet, useMatch, useNavigate } from "react-router-dom";
import { ArrowLeft, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PageSidebarTree } from "@/components/viewer/PageSidebarTree";
import { DownloadBackupButton } from "@/components/viewer/DownloadBackupButton";
import { useConnectors } from "@/hooks/useConnectors";
import { useNotionPages } from "@/hooks/useNotionPages";
import { isLocalFirstVault } from "@/lib/dataVaultMode";
import type { ViewerOutletContext } from "@/pages/viewerTypes";

/**
 * Shell for /viewer/* — workspace picker, download, sidebar tree, and nested routes.
 */
export function ViewerLayout() {
  const navigate = useNavigate();
  const workspaceSelectId = useId();
  const [selectedConnector, setSelectedConnector] = useState<string | undefined>(undefined);
  const { data: connectors = [], isLoading: loadingConnectors } = useConnectors();
  const { data: sidebarPages = [] } = useNotionPages(selectedConnector);

  const pageMatch = useMatch("/viewer/page/:pageId");
  const activePageId = pageMatch?.params.pageId;

  const singleWorkspaceName =
    connectors.length === 1 ? (connectors[0].workspace_name ?? "Your workspace") : null;

  const outletCtx: ViewerOutletContext = { selectedConnector, setSelectedConnector };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border/80 bg-card/30 shrink-0">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/dashboard")}
              className="gap-1.5 shrink-0"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden />
              Back to dashboard
            </Button>
            <div className="w-px h-4 bg-border hidden sm:block" aria-hidden />
            <div className="min-w-0">
              <h1 className="font-display text-xl font-bold truncate">
                <span className="text-foreground">Browse your backup</span>
              </h1>
              <p className="text-xs text-muted-foreground">
                {isLocalFirstVault()
                  ? "Read-only outline — page text lives in your vault, download the ZIP to read offline"
                  : "Read-only — layout and images match your last sync"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            {!loadingConnectors && connectors.length > 1 && (
              <div className="flex flex-col gap-1.5 min-w-[10rem]">
                <Label htmlFor={workspaceSelectId} className="text-xs text-muted-foreground font-normal">
                  Show data from
                </Label>
                <select
                  id={workspaceSelectId}
                  value={selectedConnector ?? ""}
                  onChange={(e) => setSelectedConnector(e.target.value || undefined)}
                  className="text-sm bg-card border border-border rounded-md px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 w-full"
                  aria-label="Choose workspace"
                >
                  <option value="">All workspaces</option>
                  {connectors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.workspace_name ?? `Workspace (${c.id.slice(0, 8)}…)`}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <DownloadBackupButton
              connectorId={selectedConnector}
              disabled={loadingConnectors || connectors.length === 0}
            />
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-8 flex flex-col lg:flex-row gap-8 min-h-0">
        {loadingConnectors ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : connectors.length === 0 ? (
          <div className="glass-card rounded-2xl border border-border/60 p-8 text-center space-y-4 max-w-lg mx-auto">
            <div className="w-12 h-12 rounded-xl bg-gradient-gold/10 border border-primary/15 flex items-center justify-center mx-auto">
              <BookOpen className="w-6 h-6 text-primary" aria-hidden />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Nothing to show yet</h2>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                Connect Notion on your dashboard, then run a backup. When the first sync finishes, your pages appear
                here with structure, images, and a ZIP you can download.
              </p>
            </div>
            <Button asChild>
              <Link to="/dashboard">Go to dashboard</Link>
            </Button>
          </div>
        ) : (
          <>
            <PageSidebarTree pages={sidebarPages} activePageId={activePageId} />
            <div className="flex-1 min-w-0 min-h-0">
              {singleWorkspaceName && (
                <p className="text-sm text-muted-foreground mb-4">
                  Showing: <span className="text-foreground font-medium">{singleWorkspaceName}</span>
                </p>
              )}
              <Outlet context={outletCtx} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
