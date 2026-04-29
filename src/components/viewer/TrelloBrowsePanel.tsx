import { useMemo, useState } from "react";
import { ExternalLink, LayoutGrid, SquareStack } from "lucide-react";
import { Link } from "react-router-dom";
import { useTrelloBoards, useTrelloCards, useTrelloLists } from "@/hooks/useTrelloData";
import {
  PanelSearchRow,
  PanelSkeleton,
  PanelEmptyState,
  PanelNoResults,
} from "./BrowsePanelKit";

/** Strip common Markdown syntax for plain-text display. */
function stripMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/gs, "$2")
    .replace(/(\*|_)(.*?)\1/gs, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

type Tab = "boards" | "cards";

/**
 * Browse view for synced Trello data (Supabase `trello_*` mirror tables).
 * Uses a tab layout (Boards / Cards) instead of a sidebar — fits Trello's flat structure.
 */
export function TrelloBrowsePanel({ connectorId }: { connectorId?: string }) {
  const [tab, setTab] = useState<Tab>("boards");
  const [query, setQuery] = useState("");
  const { data: boards = [], isLoading: loadingBoards } = useTrelloBoards(connectorId);
  const { data: cards = [], isLoading: loadingCards } = useTrelloCards(connectorId);
  const { data: lists = [] } = useTrelloLists(connectorId);

  const listNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of lists) m.set(l.id, l.name || "List");
    return m;
  }, [lists]);

  const boardNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of boards) m.set(b.id, b.name || "Board");
    return m;
  }, [boards]);

  const q = query.trim().toLowerCase();
  const filteredBoards = boards.filter((b) => (b.name ?? "").toLowerCase().includes(q));
  const filteredCards = cards.filter(
    (c) =>
      (c.name ?? "").toLowerCase().includes(q) ||
      (c.desc ?? "").toLowerCase().includes(q) ||
      (boardNameById.get(c.board_id) ?? "").toLowerCase().includes(q),
  );

  const loading = loadingBoards || loadingCards;
  const hasAny = boards.length > 0 || cards.length > 0;

  if (!connectorId) {
    return (
      <PanelEmptyState icon={LayoutGrid}>
        Choose <strong className="text-foreground">Trello</strong> in{" "}
        <strong className="text-foreground">Show data from</strong> above.
      </PanelEmptyState>
    );
  }

  if (!loading && !hasAny) {
    return (
      <PanelEmptyState icon={LayoutGrid} size="compact">
        Your Trello account is connected but no boards or cards have been backed up yet. Open the{" "}
        <Link to="/dashboard" className="text-primary font-medium hover:underline">
          Dashboard
        </Link>{" "}
        and press <strong className="text-foreground">Sync Now</strong> on the Trello card.
      </PanelEmptyState>
    );
  }

  const displayCount = tab === "boards" ? filteredBoards.length : filteredCards.length;
  const countLabel = tab === "boards" ? "board" : "card";

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div
        className="flex gap-1 border-b border-border/60"
        role="tablist"
        aria-label="Trello backup sections"
      >
        {(["boards", "cards"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={[
              "inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors rounded-t-md",
              tab === t
                ? "border-primary text-foreground bg-muted/20"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/10",
            ].join(" ")}
          >
            {t === "boards" ? (
              <LayoutGrid className="w-3.5 h-3.5" aria-hidden />
            ) : (
              <SquareStack className="w-3.5 h-3.5" aria-hidden />
            )}
            {t === "boards" ? "Boards" : "Cards"}
          </button>
        ))}
      </div>

      {/* Search + count */}
      <PanelSearchRow
        value={query}
        onChange={setQuery}
        placeholder={tab === "boards" ? "Search boards…" : "Search cards…"}
        count={displayCount}
        countLabel={countLabel}
        loading={loading}
      />

      {/* Loading skeleton */}
      {loading && <PanelSkeleton rows={4} />}

      {/* No results */}
      {!loading && displayCount === 0 && q && (
        <PanelNoResults message={`No ${tab} match your search.`} />
      )}

      {/* Boards list */}
      {!loading && tab === "boards" && filteredBoards.length > 0 && (
        <ul className="rounded-xl border border-border/60 overflow-hidden divide-y divide-border/40">
          {filteredBoards.map((b) => (
            <li
              key={b.id}
              id={`trello-board-${b.id}`}
              className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 scroll-mt-24 hover:bg-muted/10 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">
                  {b.name || "Untitled board"}
                </p>
                {b.desc ? (
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                    {stripMarkdown(b.desc)}
                  </p>
                ) : null}
              </div>
              {b.url ? (
                <a
                  href={b.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary font-medium shrink-0 hover:underline"
                >
                  Open in Trello <ExternalLink className="w-3 h-3" aria-hidden />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* Cards list */}
      {!loading && tab === "cards" && filteredCards.length > 0 && (
        <ul className="rounded-xl border border-border/60 overflow-hidden divide-y divide-border/40">
          {filteredCards.map((c) => (
            <li key={c.id} className="px-4 py-3 hover:bg-muted/10 transition-colors">
              <p className="text-sm font-medium text-foreground">{c.name || "Untitled card"}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {boardNameById.get(c.board_id) ?? c.board_id}
                {c.list_id ? ` · ${listNameById.get(c.list_id) ?? c.list_id}` : ""}
                {c.closed ? " · Archived" : ""}
              </p>
              {c.desc ? (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {stripMarkdown(c.desc)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
