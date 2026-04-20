import { LayoutGrid } from "lucide-react";
import { NavLink } from "react-router-dom";
import type { TrelloBoardRow } from "@/hooks/useTrelloData";

interface TrelloSidebarBoardsProps {
  boards: TrelloBoardRow[];
}

/**
 * Left rail for Trello browse: board names as anchors into the main list (same page).
 * Replaces Notion `PageSidebarTree` so Trello users see something meaningful.
 */
export function TrelloSidebarBoards({ boards }: TrelloSidebarBoardsProps) {
  return (
    <aside className="w-full lg:w-56 shrink-0 border-b lg:border-b-0 lg:border-r border-border/60 pb-4 lg:pb-0 lg:pr-4 flex flex-col min-h-0">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        <LayoutGrid className="w-3.5 h-3.5" aria-hidden />
        Board outline
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug mb-3">
        Boards from your last Trello sync. Tap a name to jump to that board in the list.
      </p>
      <nav className="overflow-y-auto max-h-[50vh] lg:max-h-[calc(100vh-12rem)] pr-1" aria-label="Trello boards">
        {boards.length === 0 ? (
          <p className="text-xs text-muted-foreground">No boards yet — run a Trello backup from the dashboard.</p>
        ) : (
          <ul className="space-y-0.5">
            {boards.map((b) => (
              <li key={b.id}>
                <a
                  href={`#trello-board-${b.id}`}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                >
                  <span className="truncate">{b.name || "Untitled board"}</span>
                </a>
              </li>
            ))}
          </ul>
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
        ← All boards & cards
      </NavLink>
    </aside>
  );
}
