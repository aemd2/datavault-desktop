import { useId, useMemo, useState } from "react";
import { Link, Outlet, useMatch } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppTopNav } from "@/components/AppTopNav";
import { Label } from "@/components/ui/label";
import { PageSidebarTree } from "@/components/viewer/PageSidebarTree";
import { DownloadBackupButton } from "@/components/viewer/DownloadBackupButton";
import { useConnectors } from "@/hooks/useConnectors";
import { useNotionPages } from "@/hooks/useNotionPages";
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
  const isPageReader = !!pageMatch;

  const singleWorkspaceName =
    connectors.length === 1 ? (connectors[0].workspace_name ?? "Your workspace") : null;

  // When only one workspace exists, behave as if it is selected so Browse + sidebar query the right rows
  // (otherwise `selectedConnector` stays undefined and we default connector type to Notion).
  const resolvedConnectorId = useMemo(
    () => selectedConnector ?? (connectors.length === 1 ? connectors[0]?.id : undefined),
    [selectedConnector, connectors],
  );

  const selectedConn = connectors.find((c) => c.id === resolvedConnectorId);
  // When no specific connector is chosen ("All workspaces"), use the special "all" type
  // so ViewerBrowse renders an overview instead of defaulting to the Notion panel.
  const connectorType = selectedConn?.type?.toLowerCase() ?? (connectors.length > 1 ? "all" : "notion");
  const connectorLabel = selectedConn
    ? friendlyConnectorLabel(selectedConn.type || "notion")
    : singleWorkspaceName || "Your workspace";

  const { data: sidebarPages = [] } = useNotionPages(selectedConnector);

  // Pass type and label so ViewerBrowse can show correct copy and components for Trello vs Notion.
  // `selectedConnector` uses resolved id so a single Trello-only account still loads `trello_*` rows.
  const outletCtx: ViewerOutletContext = {
    selectedConnector: resolvedConnectorId,
    setSelectedConnector,
    connectorType,
    connectorLabel,
    connectors,
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
                  {connectors.map((c) => {
                    const platform = friendlyConnectorLabel(c.type || "notion");
                    const name = c.workspace_name?.trim();
                    // Show "Platform — name" when the name adds info beyond the platform label.
                    // Avoid "Notion — Emil Donchew's Notion" (redundant) → just "Notion".
                    // Avoid showing raw emails as the primary label.
                    const isEmail = name ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name) : false;
                    const isRedundant = name
                      ? name.toLowerCase().includes(platform.toLowerCase())
                      : false;
                    const suffix = name && !isEmail && !isRedundant ? ` — ${name}` : "";
                    return (
                      <option key={c.id} value={c.id}>
                        {platform}{suffix}
                      </option>
                    );
                  })}
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
            {/*
              Outer sidebar is only useful on the Notion page reader (/viewer/page/:pageId),
              where users navigate between pages. On the browse index, every connector panel
              has its own internal sidebar/layout — keeping the outer rail there made Notion
              and Trello look inconsistent vs Asana/Todoist/Airtable/Google Sheets.
            */}
            {isPageReader && connectorType === "notion" ? (
              <PageSidebarTree pages={sidebarPages} activePageId={activePageId} />
            ) : null}
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
