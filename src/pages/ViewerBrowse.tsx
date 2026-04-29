import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  LayoutGrid,
  CheckSquare,
  ClipboardList,
  Database,
  FileSpreadsheet,
  BookOpen,
  FileText,
  ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DatabaseList } from "@/components/viewer/DatabaseList";
import { PageList } from "@/components/viewer/PageList";
import { TrelloBrowsePanel } from "@/components/viewer/TrelloBrowsePanel";
import { TodoistBrowsePanel } from "@/components/viewer/TodoistBrowsePanel";
import { AsanaBrowsePanel } from "@/components/viewer/AsanaBrowsePanel";
import { AirtableBrowsePanel } from "@/components/viewer/AirtableBrowsePanel";
import { GoogleSheetsBrowsePanel } from "@/components/viewer/GoogleSheetsBrowsePanel";
import { ObsidianBrowsePanel } from "@/components/viewer/ObsidianBrowsePanel";
import { isLocalFirstVault } from "@/lib/dataVaultMode";
import { friendlyConnectorLabel } from "@/lib/connectorDisplay";
import type { ViewerOutletContext } from "@/pages/viewerTypes";
import type { ConnectorRow } from "@/hooks/useConnectors";

type Tab = "pages" | "databases";

const NOTION_TAB_LABELS: Record<Tab, string> = {
  pages: "Pages",
  databases: "Tables",
};

function descriptionFor(
  connectorType: string,
  connectorLabel: string,
  localFirst: boolean,
): React.ReactNode {
  switch (connectorType) {
    case "trello":
      return localFirst ? (
        <>
          Boards, lists, cards, checklists, and attachments are shown here. Full data is stored
          in your private vault — press{" "}
          <strong className="text-foreground">Download backup</strong> (top-right) to get it as
          a ZIP you can open in any editor or Obsidian.
        </>
      ) : (
        <>
          Browse your Trello boards, lists, and rich cards (with checklists, attachments, labels,
          members). Data comes from the last sync. Use Download backup for a full export.
        </>
      );
    case "todoist":
      return (
        <>
          Browse your backed-up Todoist projects and tasks. Select a project on the left to
          filter, or search across all tasks. Priorities, due dates, and descriptions are
          preserved from the last sync.
        </>
      );
    case "asana":
      return (
        <>
          Browse your backed-up Asana projects and tasks. Select a project on the left to filter,
          or search across all tasks. Completed tasks can be toggled on — everything from the
          last sync is here.
        </>
      );
    case "airtable":
      return (
        <>
          Browse your backed-up Airtable bases, tables, and records. Select a base on the left,
          then a table to view its rows. Search across all field values.
        </>
      );
    case "google-sheets":
    case "google_sheets":
      return (
        <>
          Browse your backed-up Google Sheets spreadsheets and row data. Select a spreadsheet,
          then a sheet tab to view its rows. Headers are preserved from the first row.
        </>
      );
    case "obsidian":
      return (
        <>
          Browse the Markdown notes in your local Obsidian vault. Notes are read directly from
          disk — no cloud sync needed. Click Rescan vault on the Dashboard to update the note count.
        </>
      );
    default:
      // Notion and anything else
      return localFirst ? (
        <>
          Page titles and structure are shown here. Full page text is stored in your private vault —
          press <strong className="text-foreground">Download backup</strong> (top-right) to get all
          your Markdown files as a ZIP you can open in Obsidian, VS Code, or any editor.
        </>
      ) : (
        <>
          Open any page from the outline on the left to read it with headings, lists, images, and
          callouts like in {connectorLabel} — or search below. Download everything as a ZIP anytime.
        </>
      );
  }
}

// ─── Icon map for connector types ────────────────────────────────────────────

const CONNECTOR_ICONS: Record<string, LucideIcon> = {
  notion: BookOpen,
  trello: LayoutGrid,
  todoist: CheckSquare,
  asana: ClipboardList,
  airtable: Database,
  "google-sheets": FileSpreadsheet,
  "google_sheets": FileSpreadsheet,
  obsidian: FileText,
};

// ─── All-workspaces overview ──────────────────────────────────────────────────

function AllWorkspacesOverview({
  connectors,
  onSelect,
}: {
  connectors: ConnectorRow[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">All workspaces</h2>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed max-w-2xl">
          You have {connectors.length} connected service{connectors.length !== 1 ? "s" : ""}.
          Select one below to browse its backed-up data.
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {connectors.map((c) => {
          const label = friendlyConnectorLabel(c.type);
          const Icon = CONNECTOR_ICONS[c.type.toLowerCase()] ?? BookOpen;
          const name = c.workspace_name?.trim();
          const isEmail = name ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name) : false;
          const isRedundant = name ? name.toLowerCase().includes(label.toLowerCase()) : false;
          const displayName = name && !isEmail && !isRedundant ? name : null;
          const lastSync = c.last_synced_at
            ? new Date(c.last_synced_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : null;

          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                className="w-full text-left group rounded-xl border border-border/60 bg-card/40 hover:bg-card/80 hover:border-primary/30 transition-all px-4 py-4 flex items-center gap-4"
              >
                {/* Icon */}
                <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-primary" aria-hidden />
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{label}</p>
                  {displayName && (
                    <p className="text-xs text-muted-foreground truncate">{displayName}</p>
                  )}
                  {lastSync && (
                    <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                      Last sync: {lastSync}
                    </p>
                  )}
                </div>

                {/* Arrow */}
                <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────

/**
 * /viewer index — content panel that swaps based on connectorType.
 * "all"     → AllWorkspacesOverview (picker cards)
 * "notion"  → tabs (Pages / Tables)
 * "trello"  → TrelloBrowsePanel
 * "todoist" → TodoistBrowsePanel
 * "asana"   → AsanaBrowsePanel
 * "airtable"       → AirtableBrowsePanel
 * "google-sheets"  → GoogleSheetsBrowsePanel
 */
export function ViewerBrowse() {
  const ctx = useOutletContext<ViewerOutletContext>();
  const {
    selectedConnector,
    setSelectedConnector,
    connectorType = "notion",
    connectorLabel = "Your workspace",
    connectors = [],
  } = ctx;
  const [activeTab, setActiveTab] = useState<Tab>("pages");

  const title = `Your synced ${connectorLabel}`;
  const description = descriptionFor(connectorType, connectorLabel, isLocalFirstVault());

  // "All workspaces" — show an overview of every connected service
  if (connectorType === "all") {
    return (
      <AllWorkspacesOverview
        connectors={connectors}
        onSelect={(id) => setSelectedConnector(id)}
      />
    );
  }

  // Non-Notion connectors each get their own dedicated panel
  if (connectorType === "trello") {
    return (
      <>
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-foreground">{title}</h2>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed max-w-2xl">{description}</p>
        </div>
        <TrelloBrowsePanel connectorId={selectedConnector} />
      </>
    );
  }

  if (connectorType === "todoist") {
    return (
      <>
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-foreground">{title}</h2>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed max-w-2xl">{description}</p>
        </div>
        <TodoistBrowsePanel connectorId={selectedConnector} />
      </>
    );
  }

  if (connectorType === "asana") {
    return (
      <>
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-foreground">{title}</h2>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed max-w-2xl">{description}</p>
        </div>
        <AsanaBrowsePanel connectorId={selectedConnector} />
      </>
    );
  }

  if (connectorType === "airtable") {
    return (
      <>
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-foreground">{title}</h2>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed max-w-2xl">{description}</p>
        </div>
        <AirtableBrowsePanel connectorId={selectedConnector} />
      </>
    );
  }

  if (connectorType === "google-sheets" || connectorType === "google_sheets") {
    return (
      <>
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-foreground">{title}</h2>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed max-w-2xl">{description}</p>
        </div>
        <GoogleSheetsBrowsePanel connectorId={selectedConnector} />
      </>
    );
  }

  if (connectorType === "obsidian") {
    return (
      <>
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-foreground">{title}</h2>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed max-w-2xl">{description}</p>
        </div>
        <ObsidianBrowsePanel connectorId={selectedConnector} />
      </>
    );
  }

  // Default: Notion (pages + databases tabs)
  return (
    <>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground">{title}</h2>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed max-w-2xl">
          {description}
        </p>
      </div>

      <div className="flex gap-1 border-b border-border/60 mb-6" role="tablist" aria-label="What to browse">
        {(["pages", "databases"] as Tab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={[
              "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors rounded-t-md",
              activeTab === tab
                ? "border-primary text-foreground bg-muted/20"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/10",
            ].join(" ")}
          >
            {NOTION_TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={NOTION_TAB_LABELS[activeTab]}>
        {activeTab === "pages" && <PageList connectorId={selectedConnector} />}
        {activeTab === "databases" && <DatabaseList connectorId={selectedConnector} />}
      </div>
    </>
  );
}
