import { Fragment, type ReactNode } from "react";
import type { NotionBlock, NotionRichTextItem } from "@/lib/notionBlocks";

/**
 * Inline rich text with Notion-like emphasis (bold, italic, code, links).
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

/**
 * One Notion block → JSX. Recurses into ``children`` for nested structure.
 * Styling aims for a calm Notion-like reader (headings, lists, callouts, images).
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
    return (
      <pre className="rounded-lg bg-zinc-950 text-zinc-100 p-4 overflow-x-auto text-sm my-3">
        {lang ? <div className="text-xs text-zinc-400 mb-2 font-sans">{lang}</div> : null}
        <code>{codeText}</code>
      </pre>
    );
  }
  if (btype === "image" || btype === "file") {
    const file = data.file as { url?: string } | undefined;
    const external = data.external as { url?: string } | undefined;
    const url = external?.url ?? file?.url ?? "";
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

  /* Unknown block: still show nested children so structure isn’t lost. */
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
