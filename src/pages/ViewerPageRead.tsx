import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotionPageBody } from "@/components/viewer/NotionPageBody";
import { useNotionPage } from "@/hooks/useNotionPage";
import { blocksFromRawJson } from "@/lib/notionBlocks";
import { resolvePageTitle } from "@/lib/notionPageTitle";
import { isLocalFirstVault } from "@/lib/dataVaultMode";

/**
 * /viewer/page/:pageId — full page content with Notion-like layout.
 */
export function ViewerPageRead() {
  const { pageId } = useParams<{ pageId: string }>();
  const navigate = useNavigate();
  const { data: page, isLoading, error } = useNotionPage(pageId);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Opening page…</p>;
  }

  if (error || !page) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 space-y-3 max-w-lg">
        <p className="text-sm font-medium text-foreground">We couldn&apos;t load this page</p>
        <p className="text-sm text-muted-foreground">It may have been removed from your backup, or the link is old.</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/viewer")}>
          Back to all pages
        </Button>
      </div>
    );
  }

  const blocks = blocksFromRawJson(page.raw_json);
  const displayTitle = resolvePageTitle(page.title, page.raw_json) ?? page.title ?? "Untitled page";
  const edited = page.last_edited_time
    ? new Date(page.last_edited_time).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => navigate("/viewer")}>
          <ArrowLeft className="w-4 h-4" aria-hidden />
          All pages
        </Button>
      </div>

      <header className="space-y-2 border-b border-border/60 pb-6">
        <h1 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight">
          {displayTitle}
        </h1>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {edited ? <span>Last updated in Notion: {edited}</span> : null}
          {page.url ? (
            <a
              href={page.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
            >
              Open in Notion <ExternalLink className="w-3.5 h-3.5" aria-hidden />
            </a>
          ) : null}
        </div>
      </header>

      {/* In local-first vault mode blocks are stored on Storage, not in the DB.
         Show a clear explanation so users know their content is safe. */}
      {isLocalFirstVault() && blocks.length === 0 && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground/90 space-y-1">
          <p className="font-medium">Page body is in your vault</p>
          <p className="text-muted-foreground leading-relaxed">
            In local-first mode, full page text is stored as a file in your private vault — not in the
            browser database. Press{" "}
            <strong className="text-foreground">Download backup</strong> (top-right) to get a ZIP with all
            your Markdown files. Works on Windows and iOS.
          </p>
        </div>
      )}

      <NotionPageBody blocks={blocks} />

      <p className="text-xs text-muted-foreground pt-8 border-t border-border/40">
        {isLocalFirstVault() ? (
          <>
            Your page text lives in your{" "}
            <strong className="text-foreground">vault</strong> (Storage). Use{" "}
            <strong className="text-foreground">Download backup</strong> in the header to get all your
            Markdown files as a ZIP — open in Obsidian, VS Code, or any text editor.{" "}
          </>
        ) : (
          <>
            Need the raw files? Use <strong className="text-foreground">Download backup</strong> in the
            header for a ZIP of Markdown under <code className="text-foreground">pages/</code>, bundled
            images under <code className="text-foreground">assets/</code> when possible, plus{" "}
            <code className="text-foreground">structure.json</code> (parent links).{" "}
          </>
        )}
        <Link to="/viewer" className="text-primary hover:underline">
          Back to list
        </Link>
      </p>
    </div>
  );
}
