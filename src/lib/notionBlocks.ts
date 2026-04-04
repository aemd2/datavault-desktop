/**
 * Notion block JSON helpers: Markdown export (ZIP) + shared types.
 * Matches sync-engine `vault/writer.py` block handling as closely as practical.
 */

export type NotionRichTextItem = {
  plain_text?: string;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
    code?: boolean;
  };
  href?: string | null;
  text?: { link?: { url?: string } | null };
};

export type NotionBlock = {
  id?: string;
  type?: string;
  has_children?: boolean;
  children?: NotionBlock[];
  [key: string]: unknown;
};

/** Plain string from a Notion rich_text array. */
export function richTextPlain(rich: unknown): string {
  if (!Array.isArray(rich)) return "";
  return rich
    .map((t) => (t && typeof t === "object" ? String((t as NotionRichTextItem).plain_text ?? "") : ""))
    .join("");
}

/** Pull image / file URL from a block payload. */
function blockAssetUrl(data: Record<string, unknown>): string {
  const file = data.file as { url?: string } | undefined;
  const external = data.external as { url?: string } | undefined;
  return external?.url ?? file?.url ?? "";
}

/** One block subtree → Markdown (nested children preserved). */
function singleBlockMarkdown(block: NotionBlock, urlRewrite?: (url: string) => string): string {
  const btype = block.type ?? "";
  const payload = (block[btype] as Record<string, unknown>) ?? {};

  const lines: string[] = [];

  if (
    btype === "paragraph" ||
    btype === "heading_1" ||
    btype === "heading_2" ||
    btype === "heading_3" ||
    btype === "bulleted_list_item" ||
    btype === "numbered_list_item" ||
    btype === "toggle" ||
    btype === "quote" ||
    btype === "callout"
  ) {
    const text = richTextPlain(payload.rich_text);
    const prefix: Record<string, string> = {
      heading_1: "# ",
      heading_2: "## ",
      heading_3: "### ",
      bulleted_list_item: "- ",
      numbered_list_item: "1. ",
      quote: "> ",
      callout: "> 📌 ",
    };
    if (text) lines.push(`${prefix[btype] ?? ""}${text}`);
  } else if (btype === "to_do") {
    const text = richTextPlain(payload.rich_text);
    const checked = Boolean(payload.checked);
    const mark = checked ? "[x]" : "[ ]";
    if (text) lines.push(`- ${mark} ${text}`);
  } else if (btype === "divider") {
    lines.push("---");
  } else if (btype === "image" || btype === "file") {
    const url = blockAssetUrl(payload);
    const caption = richTextPlain(payload.caption);
    if (url) {
      const href = urlRewrite ? urlRewrite(url) : url;
      lines.push(`![${caption || btype}](${href})`);
    }
  } else if (btype === "code") {
    const text = richTextPlain(payload.rich_text);
    const lang = String(payload.language ?? "");
    lines.push(`\`\`\`${lang}\n${text}\n\`\`\``);
  }

  const kids = Array.isArray(block.children) ? block.children : [];
  if (kids.length) {
    const nested = blocksToMarkdown(kids, urlRewrite);
    if (nested) lines.push(nested);
  }

  return lines.join("\n\n");
}

/**
 * Full page block list → Markdown body (for .md files inside ZIP).
 * Optional urlRewrite maps Notion asset URLs to relative paths (e.g. after bundling into assets/).
 */
export function blocksToMarkdown(
  blocks: NotionBlock[] | undefined | null,
  urlRewrite?: (url: string) => string,
): string {
  if (!blocks?.length) return "";
  const parts = blocks.map((b) => singleBlockMarkdown(b, urlRewrite)).filter(Boolean);
  return parts.join("\n\n");
}

/** Read blocks from raw_json stored by the sync engine. */
export function blocksFromRawJson(raw: unknown): NotionBlock[] {
  if (!raw || typeof raw !== "object") return [];
  const b = (raw as { blocks?: unknown }).blocks;
  return Array.isArray(b) ? (b as NotionBlock[]) : [];
}
