import { Fragment, type ReactNode } from "react";
import type { NotionBlock, NotionRichTextItem } from "@/lib/notionBlocks";
import { richTextPlain } from "@/lib/notionBlocks";

/**
 * Inline rich text with Notion-like emphasis (bold, italic, code, links, colors).
 */
function RichText({ fragments }: { fragments: unknown }) {
  if (!Array.isArray(fragments) || fragments.length === 0) return null;
  return (
    <>
      {fragments.map((raw, i) => {
        const t = raw as NotionRichTextItem;
        const text = t.plain_text ?? "";
        const linkUrl = t.href ?? t.text?.link?.url ?? null;
        const a = t.annotations ?? {};
        let node: ReactNode = text;
        if (a.code) {
          node = (
            <code className="rounded bg-muted/80 px-1 py-0.5 text-[0.9em] font-mono text-foreground">{text}</code>
          );
        }
        if (a.bold) node = <strong className="font-semibold text-foreground">{node}</strong>;
        if (a.italic) node = <em className="italic">{node}</em>;
        if (a.strikethrough) node = <del className="line-through opacity-80">{node}</del>;
        if (a.underline) node = <span className="underline underline-offset-2">{node}</span>;
        if (linkUrl) {
          node = (
            <a
              href={linkUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-90"
            >
              {node}
            </a>
          );
        }
        // Notion color support
        if (a.color && a.color !== "default") {
          const colorMap: Record<string, string> = {
            gray: "text-gray-500", brown: "text-amber-700", orange: "text-orange-500",
            yellow: "text-yellow-500", green: "text-green-500", blue: "text-blue-500",
            purple: "text-purple-500", pink: "text-pink-500", red: "text-red-500",
            gray_background: "bg-gray-100 dark:bg-gray-800",
            brown_background: "bg-amber-50 dark:bg-amber-900/30",
            orange_background: "bg-orange-50 dark:bg-orange-900/30",
            yellow_background: "bg-yellow-50 dark:bg-yellow-900/30",
            green_background: "bg-green-50 dark:bg-green-900/30",
            blue_background: "bg-blue-50 dark:bg-blue-900/30",
            purple_background: "bg-purple-50 dark:bg-purple-900/30",
            pink_background: "bg-pink-50 dark:bg-pink-900/30",
            red_background: "bg-red-50 dark:bg-red-900/30",
          };
          const cls = colorMap[a.color];
          if (cls) node = <span className={cls}>{node}</span>;
        }
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}

function BlockChildren({ blocks }: { blocks: NotionBlock[] }) {
  if (!blocks.length) return null;
  return (
    <div className="notion-nested ml-3 pl-3 border-l border-border/50 space-y-2 mt-2">
      {blocks.map((b, i) => (
        <NotionBlockView key={b.id ?? `n-${i}`} block={b} />
      ))}
    </div>
  );
}

/** Pull asset URL from a block's data payload. */
function blockAssetUrl(data: Record<string, unknown>): string {
  const file = data.file as { url?: string } | undefined;
  const external = data.external as { url?: string } | undefined;
  return external?.url ?? file?.url ?? "";
}

/**
 * One Notion block → JSX. Recurses into ``children`` for nested structure.
 * Styling aims for a calm Notion-like reader (headings, lists, callouts, images).
 *
 * v2: handles tables, bookmarks, embeds, video, audio, pdf, equations,
 *     column layouts, child pages/databases, synced blocks.
 */
function NotionBlockView({ block }: { block: NotionBlock }) {
  const btype = block.type ?? "";
  const data = (block[btype] as Record<string, unknown>) ?? {};
  const kids = Array.isArray(block.children) ? block.children : [];

  if (btype === "paragraph") {
    return (
      <p className="text-[15px] leading-7 text-foreground/95 min-h-[1.75rem]">
        <RichText fragments={data.rich_text} />
      </p>
    );
  }
  if (btype === "heading_1") {
    return (
      <h2 className="text-2xl font-bold text-foreground tracking-tight mt-8 mb-2 first:mt-0">
        <RichText fragments={data.rich_text} />
      </h2>
    );
  }
  if (btype === "heading_2") {
    return (
      <h3 className="text-xl font-semibold text-foreground mt-6 mb-2">
        <RichText fragments={data.rich_text} />
      </h3>
    );
  }
  if (btype === "heading_3") {
    return (
      <h4 className="text-lg font-semibold text-foreground mt-4 mb-1.5">
        <RichText fragments={data.rich_text} />
      </h4>
    );
  }
  if (btype === "bulleted_list_item") {
    return (
      <div className="flex gap-2 text-[15px] leading-7">
        <span className="text-muted-foreground select-none mt-0.5">•</span>
        <div className="flex-1 space-y-1">
          <RichText fragments={data.rich_text} />
          <BlockChildren blocks={kids} />
        </div>
      </div>
    );
  }
  if (btype === "numbered_list_item") {
    return (
      <div className="flex gap-2 text-[15px] leading-7">
        <span className="text-muted-foreground select-none mt-0.5 w-5 text-right text-sm">1.</span>
        <div className="flex-1 space-y-1">
          <RichText fragments={data.rich_text} />
          <BlockChildren blocks={kids} />
        </div>
      </div>
    );
  }
  if (btype === "to_do") {
    const checked = Boolean(data.checked);
    return (
      <div className="flex gap-2 items-start text-[15px] leading-7">
        <span className="mt-1 text-muted-foreground" aria-hidden>
          {checked ? "☑" : "☐"}
        </span>
        <div className="flex-1 space-y-1">
          <span className={checked ? "line-through opacity-70" : undefined}>
            <RichText fragments={data.rich_text} />
          </span>
          <BlockChildren blocks={kids} />
        </div>
      </div>
    );
  }
  if (btype === "toggle") {
    return (
      <details className="group rounded-md border border-border/60 bg-muted/15 px-3 py-2">
        <summary className="cursor-pointer text-[15px] font-medium text-foreground list-none [&::-webkit-details-marker]:hidden">
          <span className="inline-block w-4 text-muted-foreground group-open:rotate-90 transition-transform">▸</span>{" "}
          <RichText fragments={data.rich_text} />
        </summary>
        <BlockChildren blocks={kids} />
      </details>
    );
  }
  if (btype === "quote") {
    return (
      <blockquote className="border-l-4 border-primary/40 pl-4 py-1 my-2 text-[15px] leading-7 text-muted-foreground italic">
        <RichText fragments={data.rich_text} />
        <BlockChildren blocks={kids} />
      </blockquote>
    );
  }
  if (btype === "callout") {
    const icon = (data.icon as { emoji?: string } | undefined)?.emoji ?? "💡";
    return (
      <div className="flex gap-3 rounded-lg bg-muted/40 border border-border/50 px-3 py-3 my-2">
        <span className="text-lg shrink-0" aria-hidden>
          {icon}
        </span>
        <div className="flex-1 text-[15px] leading-7 space-y-2">
          <RichText fragments={data.rich_text} />
          <BlockChildren blocks={kids} />
        </div>
      </div>
    );
  }
  if (btype === "divider") {
    return <hr className="my-6 border-border/60" />;
  }
  if (btype === "code") {
    const lang = String(data.language ?? "");
    const codeText = Array.isArray(data.rich_text)
      ? (data.rich_text as NotionRichTextItem[]).map((x) => x.plain_text ?? "").join("")
      : "";
    const caption = data.caption;
    return (
      <div className="my-3">
        <pre className="rounded-lg bg-zinc-950 text-zinc-100 p-4 overflow-x-auto text-sm">
          {lang ? <div className="text-xs text-zinc-400 mb-2 font-sans">{lang}</div> : null}
          <code>{codeText}</code>
        </pre>
        {Array.isArray(caption) && caption.length > 0 ? (
          <p className="text-xs text-muted-foreground mt-1"><RichText fragments={caption} /></p>
        ) : null}
      </div>
    );
  }
  if (btype === "image" || btype === "file") {
    const url = blockAssetUrl(data);
    const caption = data.caption;
    if (!url) return kids.length ? <BlockChildren blocks={kids} /> : null;
    return (
      <figure className="my-4 space-y-2">
        <img
          src={url}
          alt=""
          className="rounded-lg border border-border/50 max-w-full h-auto max-h-[min(70vh,720px)] object-contain bg-muted/20"
          loading="lazy"
        />
        {Array.isArray(caption) && caption.length > 0 ? (
          <figcaption className="text-sm text-muted-foreground text-center">
            <RichText fragments={caption} />
          </figcaption>
        ) : null}
        <BlockChildren blocks={kids} />
      </figure>
    );
  }

  // ── Video ──
  if (btype === "video") {
    const url = blockAssetUrl(data);
    const caption = data.caption;
    if (!url) return null;
    // YouTube/Vimeo → iframe, otherwise HTML5 video tag.
    const isYoutube = url.includes("youtube.com") || url.includes("youtu.be");
    const isVimeo = url.includes("vimeo.com");
    if (isYoutube || isVimeo) {
      let embedUrl = url;
      if (isYoutube) {
        const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
        if (match) embedUrl = `https://www.youtube.com/embed/${match[1]}`;
      }
      return (
        <figure className="my-4 space-y-2">
          <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
            <iframe
              src={embedUrl}
              className="absolute inset-0 w-full h-full rounded-lg border border-border/50"
              allowFullScreen
              loading="lazy"
            />
          </div>
          {Array.isArray(caption) && caption.length > 0 ? (
            <figcaption className="text-sm text-muted-foreground text-center"><RichText fragments={caption} /></figcaption>
          ) : null}
        </figure>
      );
    }
    return (
      <figure className="my-4 space-y-2">
        <video src={url} controls className="rounded-lg max-w-full max-h-[70vh]" />
        {Array.isArray(caption) && caption.length > 0 ? (
          <figcaption className="text-sm text-muted-foreground text-center"><RichText fragments={caption} /></figcaption>
        ) : null}
      </figure>
    );
  }

  // ── Audio ──
  if (btype === "audio") {
    const url = blockAssetUrl(data);
    const caption = data.caption;
    if (!url) return null;
    return (
      <figure className="my-4 space-y-2">
        <audio src={url} controls className="w-full" />
        {Array.isArray(caption) && caption.length > 0 ? (
          <figcaption className="text-sm text-muted-foreground"><RichText fragments={caption} /></figcaption>
        ) : null}
      </figure>
    );
  }

  // ── PDF ──
  if (btype === "pdf") {
    const url = blockAssetUrl(data);
    const caption = data.caption;
    if (!url) return null;
    return (
      <figure className="my-4 space-y-2">
        <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-primary underline hover:opacity-90">
          <span>📄</span> {richTextPlain(caption) || "Download PDF"}
        </a>
      </figure>
    );
  }

  // ── Equation (LaTeX) ──
  if (btype === "equation") {
    const expr = (data.expression as string) ?? "";
    return (
      <div className="my-3 px-4 py-3 bg-muted/30 rounded-lg font-mono text-sm overflow-x-auto text-center">
        {expr}
      </div>
    );
  }

  // ── Bookmark ──
  if (btype === "bookmark") {
    const url = (data.url as string) ?? "";
    const caption = data.caption;
    if (!url) return null;
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-3 my-3 px-4 py-3 rounded-lg border border-border/60 bg-muted/20 hover:bg-muted/40 transition-colors"
      >
        <span className="text-lg">🔗</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-primary truncate">{richTextPlain(caption) || url}</div>
          <div className="text-xs text-muted-foreground truncate">{url}</div>
        </div>
      </a>
    );
  }

  // ── Embed ──
  if (btype === "embed") {
    const url = (data.url as string) ?? "";
    const caption = data.caption;
    if (!url) return null;
    return (
      <figure className="my-4 space-y-2">
        <div className="relative w-full rounded-lg border border-border/50 overflow-hidden" style={{ paddingBottom: "56.25%" }}>
          <iframe
            src={url}
            className="absolute inset-0 w-full h-full"
            allowFullScreen
            loading="lazy"
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
        {Array.isArray(caption) && caption.length > 0 ? (
          <figcaption className="text-sm text-muted-foreground text-center"><RichText fragments={caption} /></figcaption>
        ) : null}
      </figure>
    );
  }

  // ── Link preview ──
  if (btype === "link_preview") {
    const url = (data.url as string) ?? "";
    if (!url) return null;
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="block my-3 px-4 py-3 rounded-lg border border-border/60 bg-muted/20 hover:bg-muted/40 text-sm text-primary truncate"
      >
        🔗 {url}
      </a>
    );
  }

  // ── Link to page ──
  if (btype === "link_to_page") {
    const pageId = (data.page_id as string) ?? (data.database_id as string) ?? "";
    if (!pageId) return null;
    return (
      <div className="my-2 text-sm text-muted-foreground flex items-center gap-1">
        <span>↗️</span> <span className="italic">Link to another page</span>
      </div>
    );
  }

  // ── Child page reference ──
  if (btype === "child_page") {
    const title = (data.title as string) ?? "Untitled";
    return (
      <div className="my-2 flex items-center gap-2 text-[15px]">
        <span>📄</span>
        <span className="font-medium text-foreground">{title}</span>
      </div>
    );
  }

  // ── Child database reference ──
  if (btype === "child_database") {
    const title = (data.title as string) ?? "Untitled Database";
    return (
      <div className="my-2 flex items-center gap-2 text-[15px]">
        <span>🗄️</span>
        <span className="font-medium text-foreground">{title}</span>
      </div>
    );
  }

  // ── Table ──
  if (btype === "table") {
    const hasColumnHeader = Boolean(data.has_column_header);
    const hasRowHeader = Boolean(data.has_row_header);
    if (!kids.length) return null;
    return (
      <div className="my-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {kids.map((row, ri) => {
              const rowPayload = (row.table_row as { cells?: unknown[][] }) ?? {};
              const cells = rowPayload.cells ?? [];
              const isHeader = hasColumnHeader && ri === 0;
              const Tag = isHeader ? "th" : "td";
              return (
                <tr key={row.id ?? `tr-${ri}`} className={isHeader ? "bg-muted/40" : ri % 2 === 0 ? "bg-transparent" : "bg-muted/10"}>
                  {cells.map((cell, ci) => {
                    const isRowH = hasRowHeader && ci === 0 && !isHeader;
                    return (
                      <Tag
                        key={ci}
                        className={`border border-border/50 px-3 py-2 text-left ${isHeader || isRowH ? "font-semibold" : ""}`}
                      >
                        <RichText fragments={cell} />
                      </Tag>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // ── Column list (multi-column layout) ──
  if (btype === "column_list") {
    return (
      <div className="my-4 flex gap-4 flex-wrap">
        {kids.map((col, ci) => {
          const colKids = Array.isArray(col.children) ? col.children : [];
          return (
            <div key={col.id ?? `col-${ci}`} className="flex-1 min-w-[200px] space-y-2">
              {colKids.map((b, i) => (
                <NotionBlockView key={b.id ?? `cb-${i}`} block={b} />
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  // ── Column (child of column_list — rendered by column_list) ──
  if (btype === "column") {
    return <BlockChildren blocks={kids} />;
  }

  // ── Synced block (just render its children) ──
  if (btype === "synced_block") {
    return kids.length ? <BlockChildren blocks={kids} /> : null;
  }

  // ── Table of contents ──
  if (btype === "table_of_contents") {
    return (
      <div className="my-3 text-sm text-muted-foreground italic">
        [Table of Contents]
      </div>
    );
  }

  // ── Breadcrumb ──
  if (btype === "breadcrumb") {
    return null; // No useful content to render.
  }

  /* Unknown block: still show nested children so structure isn't lost. */
  if (kids.length) return <BlockChildren blocks={kids} />;
  return null;
}

interface NotionPageBodyProps {
  blocks: NotionBlock[];
}

/**
 * Renders synced Notion blocks in reading layout (Notion-adjacent typography and spacing).
 */
export function NotionPageBody({ blocks }: NotionPageBodyProps) {
  if (!blocks.length) {
    return (
      <p className="text-sm text-muted-foreground leading-relaxed">
        No page content was synced yet. Run a fresh backup from the dashboard — we pull text, images, and structure
        from Notion on each sync. Image links from Notion may expire after some time; run another backup to refresh
        them.
      </p>
    );
  }

  return (
    <article className="prose prose-neutral dark:prose-invert max-w-none prose-p:my-2 prose-headings:scroll-mt-20">
      <div className="space-y-1 max-w-[720px]">
        {blocks.map((b, i) => (
          <NotionBlockView key={b.id ?? `block-${i}`} block={b} />
        ))}
      </div>
    </article>
  );
}
