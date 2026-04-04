import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNotionPages, type NotionPageRow } from "@/hooks/useNotionPages";

function PageExpandRow({ page }: { page: NotionPageRow }) {
  const [open, setOpen] = useState(false);

  const edited = page.last_edited_time
    ? new Date(page.last_edited_time).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <li className="last:border-b-0">
      <div className="flex items-stretch gap-0 border-b border-border/40 last:border-0">
        <Link
          to={`/viewer/page/${page.id}`}
          className="flex flex-1 items-center gap-2 min-w-0 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
        >
          <FileText className="w-4 h-4 text-primary shrink-0" aria-hidden />
          <span className="flex-1 text-sm font-medium text-foreground truncate">
            {page.title || "Untitled page"}
          </span>
          <span className="text-xs text-primary font-medium shrink-0 hidden sm:inline">Read</span>
          {edited ? (
            <span className="text-xs text-muted-foreground hidden md:block shrink-0">{edited}</span>
          ) : null}
        </Link>
        <button
          type="button"
          className="shrink-0 px-3 border-l border-border/40 hover:bg-muted/40 transition-colors"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Hide page details" : "Show page details"}
        >
          {open ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" aria-hidden />
          )}
        </button>
      </div>

      {open && (
        <div className="px-4 pb-4 pt-0 pl-12 space-y-2 text-sm border-b border-border/40">
          {edited && <p className="text-muted-foreground">Last updated in Notion: {edited}</p>}
          {page.url && (
            <a
              href={page.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
            >
              Open this page in Notion <ExternalLink className="w-3.5 h-3.5" aria-hidden />
            </a>
          )}
          {/* Technical ID — only for support; most people never need this. */}
          <p className="text-xs text-muted-foreground pt-1 border-t border-border/40">
            Reference ID (support only):{" "}
            <span className="font-mono text-foreground break-all">{page.id}</span>
          </p>
        </div>
      )}
    </li>
  );
}

interface PageListProps {
  connectorId?: string;
}

export function PageList({ connectorId }: PageListProps) {
  const [query, setQuery] = useState("");
  const { data: pages = [], isLoading, error } = useNotionPages(connectorId);

  const filtered = pages.filter((p) => (p.title ?? "").toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Input
          placeholder="Search by page title…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-md"
          aria-label="Search pages by title"
        />
        <p className="text-xs text-muted-foreground">
          Tap the page name to read your backup (like Notion). Use ▸ for dates and the link to open in Notion.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading your pages…</p>}

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-2">
          <p className="text-sm text-foreground font-medium">We couldn&apos;t load your pages</p>
          <p className="text-sm text-muted-foreground">
            Try refreshing the page. If you never ran a sync, go to the dashboard and press{" "}
            <strong className="text-foreground">Sync Now</strong> first.
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link to="/dashboard">Open dashboard</Link>
          </Button>
        </div>
      )}

      {!isLoading && filtered.length === 0 && !error && (
        <div className="rounded-xl border border-border/60 bg-muted/10 p-6 space-y-3 text-center sm:text-left">
          <p className="text-sm text-foreground font-medium">
            {query ? "No pages match that search." : "No pages in your backup yet."}
          </p>
          {!query && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              After you connect Notion, run a sync from the dashboard. Pages show up here automatically.
            </p>
          )}
          {!query && (
            <Button variant="secondary" size="sm" asChild>
              <Link to="/dashboard">Back to dashboard</Link>
            </Button>
          )}
        </div>
      )}

      {filtered.length > 0 && (
        <>
          <ul className="glass-card rounded-xl border border-border/60 overflow-hidden">
            {filtered.map((page) => (
              <PageExpandRow key={page.id} page={page} />
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Showing {filtered.length} page{filtered.length !== 1 ? "s" : ""}
            {query ? " matching your search" : ""}.
          </p>
        </>
      )}
    </div>
  );
}
