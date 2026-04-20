import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { DatabaseList } from "@/components/viewer/DatabaseList";
import { PageList } from "@/components/viewer/PageList";
import { TrelloBrowsePanel } from "@/components/viewer/TrelloBrowsePanel";
import { isLocalFirstVault } from "@/lib/dataVaultMode";
import type { ViewerOutletContext } from "@/pages/viewerTypes";

type Tab = "pages" | "databases";

const NOTION_TAB_LABELS: Record<Tab, string> = {
  pages: "Pages",
  databases: "Tables",
};

/**
 * /viewer index — tabs for flat list + tables (sidebar shows tree on the left).
 */
export function ViewerBrowse() {
  const ctx = useOutletContext<ViewerOutletContext>();
  const { selectedConnector, connectorType = "notion", connectorLabel = "Your workspace" } = ctx;
  const [activeTab, setActiveTab] = useState<Tab>("pages");

  // Dynamic title and description based on connector type. This fixes the Trello browse bug
  // where it still said "Your synced Notion" and "No pages in your backup yet".
  // For Trello we now show rich data from the expanded sync (checklists, attachments, etc.).
  const isTrello = connectorType === "trello";
  const title = `Your synced ${connectorLabel}`;
  const description = isLocalFirstVault() ? (
    isTrello ? (
      <>
        Boards, lists, cards, checklists, and attachments are shown here. Full data (including
        Markdown-ready checklists) is stored in your private vault — press{" "}
        <strong className="text-foreground">Download backup</strong> (top-right) to get it as a ZIP.
        Open in any editor or Obsidian.
      </>
    ) : (
      <>
        Page titles and structure are shown here. Full page text is stored in your private vault —
        press <strong className="text-foreground">Download backup</strong> (top-right) to get all
        your Markdown files as a ZIP you can open in Obsidian, VS Code, or any editor.
        Works on Windows and iOS.
      </>
    )
  ) : (
    isTrello ? (
      <>
        Browse your Trello boards, lists, and rich cards (with checklists, attachments, labels, members).
        Data comes from the last sync. Use Download backup for full export including attachments.
      </>
    ) : (
      <>
        Open any page from the outline on the left to read it with headings, lists, images, and
        callouts like in Notion — or search below. Download everything as a ZIP anytime (button
        in the header).
      </>
    )
  );

  // Trello uses real `trello_*` tables — never the Notion page/table lists.
  if (isTrello) {
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
