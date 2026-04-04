import { NavLink } from "react-router-dom";
import { ChevronRight, FolderOpen } from "lucide-react";
import { buildPageTree, type PageTreeNode } from "@/lib/pageTree";
import type { NotionPageRow } from "@/hooks/useNotionPages";

function TreeRows({
  nodes,
  depth,
  activePageId,
}: {
  nodes: PageTreeNode[];
  depth: number;
  activePageId?: string;
}) {
  return (
    <ul className={depth === 0 ? "space-y-0.5" : "mt-1 space-y-0.5 pl-2 border-l border-border/40 ml-1.5"}>
      {nodes.map((n) => (
        <li key={n.id}>
          <NavLink
            to={`/viewer/page/${n.id}`}
            className={({ isActive }) =>
              [
                "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                isActive || activePageId === n.id
                  ? "bg-primary/15 text-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              ].join(" ")
            }
          >
            {n.children.length > 0 ? (
              <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-60" aria-hidden />
            ) : (
              <span className="w-3.5 shrink-0 inline-block" aria-hidden />
            )}
            <span className="truncate">{n.title || "Untitled"}</span>
          </NavLink>
          {n.children.length > 0 ? (
            <TreeRows nodes={n.children} depth={depth + 1} activePageId={activePageId} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

interface PageSidebarTreeProps {
  pages: NotionPageRow[];
  activePageId?: string;
}

/**
 * Left sidebar: pages grouped like Notion (nested under parent pages when we have parent_id).
 */
export function PageSidebarTree({ pages, activePageId }: PageSidebarTreeProps) {
  const tree = buildPageTree(pages);

  return (
    <aside className="w-full lg:w-56 shrink-0 border-b lg:border-b-0 lg:border-r border-border/60 pb-4 lg:pb-0 lg:pr-4 flex flex-col min-h-0">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        <FolderOpen className="w-3.5 h-3.5" aria-hidden />
        Page outline
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug mb-3">
        Same parent/child layout as in Notion (when we have it). Top-level pages include anything not nested under
        another synced page.
      </p>
      <nav className="overflow-y-auto max-h-[50vh] lg:max-h-[calc(100vh-12rem)] pr-1" aria-label="Pages in your backup">
        {tree.length === 0 ? (
          <p className="text-xs text-muted-foreground">No pages yet — run a backup from the dashboard.</p>
        ) : (
          <TreeRows nodes={tree} depth={0} activePageId={activePageId} />
        )}
      </nav>
      <NavLink
        to="/viewer"
        end
        className={({ isActive }) =>
          [
            "mt-4 text-xs font-medium rounded-md px-2 py-1.5 transition-colors",
            isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
          ].join(" ")
        }
      >
        ← All pages &amp; tables
      </NavLink>
    </aside>
  );
}
