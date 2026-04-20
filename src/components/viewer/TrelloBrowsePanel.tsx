import { useMemo, useState } from "react";
import { ExternalLink, LayoutGrid, SquareStack } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTrelloBoards, useTrelloCards, useTrelloLists } from "@/hooks/useTrelloData";

type Tab = "boards" | "cards";

/**
 * Browse view for synced Trello data (Supabase `trello_*` mirror tables).
 * OAuth only creates `connectors` — this UI reads boards/lists/cards after `run-sync`.
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

  const emptyHint = !connectorId ? (
    <p className="text-sm text-muted-foreground leading-relaxed">
      Choose <strong className="text-foreground">Trello</strong> in <strong className="text-foreground">Show data from</strong> above
      (when you have more than one workspace).
    </p>
  ) : (
    <p className="text-sm text-muted-foreground leading-relaxed">
      Your Trello account is connected, but this backup has no boards or cards yet. Open the{" "}
      <strong className="text-foreground">Dashboard</strong> and press <strong className="text-foreground">Sync Now</strong>{" "}
      on the Trello card. When the sync finishes, boards and cards appear here automatically.
    </p>
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-border/60" role="tablist" aria-label="Trello backup sections">
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
            {t === "boards" ? <LayoutGrid className="w-4 h-4" aria-hidden /> : <SquareStack className="w-4 h-4" aria-hidden />}
            {t === "boards" ? "Boards" : "Cards"}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <Input
          placeholder={tab === "boards" ? "Search boards…" : "Search cards (title, description, board)…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-md"
          aria-label="Search Trello backup"
        />
        <p className="text-xs text-muted-foreground">
          {tab === "boards"
            ? "Boards come from your last successful Trello sync."
            : "Cards are grouped by board; open the link to view the card in Trello."}
        </p>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading your Trello backup…</p>}

      {!loading && !connectorId && (
        <div className="rounded-xl border border-border/60 bg-muted/10 p-6 space-y-3">{emptyHint}</div>
      )}

      {!loading && connectorId && !hasAny && (
        <div className="rounded-xl border border-border/60 bg-muted/10 p-6 space-y-3 text-center sm:text-left">
          <p className="text-sm text-foreground font-medium">{q ? "No matches." : "No Trello data in this backup yet."}</p>
          {!q && emptyHint}
          {!q && (
            <Button variant="secondary" size="sm" asChild>
              <Link to="/dashboard">Open dashboard</Link>
            </Button>
          )}
        </div>
      )}

      {!loading && connectorId && tab === "boards" && hasAny && (
        <ul className="glass-card rounded-xl border border-border/60 overflow-hidden divide-y divide-border/40">
          {(q ? filteredBoards : boards).map((b) => (
            <li
              key={b.id}
              id={`trello-board-${b.id}`}
              className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 scroll-mt-24"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">{b.name || "Untitled board"}</p>
                {b.desc ? (
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{b.desc}</p>
                ) : null}
              </div>
              {b.url ? (
                <a
                  href={b.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary font-medium shrink-0"
                >
                  Open in Trello <ExternalLink className="w-3.5 h-3.5" aria-hidden />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {!loading && connectorId && tab === "cards" && hasAny && (
        <ul className="glass-card rounded-xl border border-border/60 overflow-hidden divide-y divide-border/40">
          {(q ? filteredCards : cards).map((c) => (
            <li key={c.id} className="px-4 py-3">
              <p className="text-sm font-medium text-foreground">{c.name || "Untitled card"}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Board: {boardNameById.get(c.board_id) ?? c.board_id}
                {c.list_id ? ` · List: ${listNameById.get(c.list_id) ?? c.list_id}` : ""}
                {c.closed ? " · Archived" : ""}
              </p>
              {c.desc ? <p className="text-xs text-muted-foreground mt-1 line-clamp-3 whitespace-pre-wrap">{c.desc}</p> : null}
            </li>
          ))}
        </ul>
      )}

      {!loading && connectorId && hasAny && (
        <p className="text-xs text-muted-foreground">
          Showing {tab === "boards" ? filteredBoards.length : filteredCards.length}{" "}
          {tab === "boards" ? "board" : "card"}
          {(tab === "boards" ? filteredBoards.length : filteredCards.length) !== 1 ? "s" : ""}
          {q ? " matching your search" : ""}.
        </p>
      )}
    </div>
  );
}
