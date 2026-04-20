import { useId, useMemo, useState } from "react";
import { Link, Outlet, useMatch } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppTopNav } from "@/components/AppTopNav";
import { Label } from "@/components/ui/label";
import { PageSidebarTree } from "@/components/viewer/PageSidebarTree";
import { TrelloSidebarBoards } from "@/components/viewer/TrelloSidebarBoards";
import { DownloadBackupButton } from "@/components/viewer/DownloadBackupButton";
import { useConnectors } from "@/hooks/useConnectors";
import { useNotionPages } from "@/hooks/useNotionPages";
import { useTrelloBoards } from "@/hooks/useTrelloData";
import { isLocalFirstVault } from "@/lib/dataVaultMode";
import { friendlyConnectorLabel } from "@/lib/connectorDisplay";
import type { ViewerOutletContext } from "@/pages/viewerTypes";

/**
 * Shell for /viewer/* — workspace picker, download, sidebar tree, and nested routes.
 */
export function ViewerLayout() {
  const workspaceSelectId = useId();
  const [selectedConnector, setSelectedConnector] = useState<string | undefined>(undefined);
  const { data: connectors = [], isLoading: loadingConnectors } = useConnectors();

  const pageMatch = useMatch("/viewer/page/:pageId");
  const activePageId = pageMatch?.params.pageId;

  const singleWorkspaceName =
    connectors.length === 1 ? (connectors[0].workspace_name ?? "Your workspace") : null;

  // When only one workspace exists, behave as if it is selected so Browse + sidebar query the right rows
  // (otherwise `selectedConnector` stays undefined and we default connector type to Notion).
  const resolvedConnectorId = useMemo(
    () => selectedConnector ?? (connectors.length === 1 ? connectors[0]?.id : undefined),
    [selectedConnector, connectors],
  );

  const selectedConn = connectors.find((c) => c.id === resolvedConnectorId);
  const connectorType = selectedConn?.type?.toLowerCase() || "notion";
  const connectorLabel = selectedConn
    ? friendlyConnectorLabel(selectedConn.type || "notion")
    : singleWorkspaceName || "Your workspace";

  const { data: sidebarPages = [] } = useNotionPages(selectedConnector);
  const { data: trelloSidebarBoards = [] } = useTrelloBoards(
    connectorType === "trello" ? resolvedConnectorId : undefined,
  );

  // Pass type and label so ViewerBrowse can show correct copy and components for Trello vs Notion.
  // `selectedConnector` uses resolved id so a single Trello-only account still loads `trello_*` rows.
  const outletCtx: ViewerOutletContext = {
    selectedConnector: resolvedConnectorId,
    setSelectedConnector,
    connectorType,
    connectorLabel,
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <AppTopNav active="viewer" />

      {/* Viewer tools: same sub-bar pattern as before, under the shared app chrome. */}
      <div className="border-b border-border/80 bg-card/20 shrink-0">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold text-foreground truncate">Browse your backup</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isLocalFirstVault()
                ? "Read-only outline — page text lives in your vault, download the ZIP to read offline"
                : "Read-only — layout and images match your last sync"}
            </p>
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
      </div>

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
            {connectorType === "trello" ? (
              <TrelloSidebarBoards boards={trelloSidebarBoards} />
            ) : (
              <PageSidebarTree pages={sidebarPages} activePageId={activePageId} />
            )}
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
