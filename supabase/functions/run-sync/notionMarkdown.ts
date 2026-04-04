/**
 * Notion block tree → Markdown string (Edge/Deno runtime).
 * Kept in sync with src/lib/notionBlocks.ts (browser version).
 * Used by run-sync when DATAVAULT_STORE_FULL_PAYLOAD=false to build page .md files
 * that are uploaded to Storage instead of stored as raw_json blocks in Postgres.
 */

export type NotionBlock = {
  id?: string;
  type?: string;
  has_children?: boolean;
  children?: NotionBlock[];
  [key: string]: unknown;
};

/** Plain text from a Notion rich_text array. */
function richTextPlain(rich: unknown): string {
  if (!Array.isArray(rich)) return "";
  return rich
    .map((t) =>
      t && typeof t === "object"
        ? String((t as { plain_text?: string }).plain_text ?? "")
        : ""
    )
    .join("");
}

/** Resolve the image/file URL from a block's data payload. */
function blockAssetUrl(data: Record<string, unknown>): string {
  const file = data.file as { url?: string } | undefined;
  const external = data.external as { url?: string } | undefined;
  return external?.url ?? file?.url ?? "";
}

/** Convert one block (and its nested children) to Markdown. */
function singleBlockMarkdown(block: NotionBlock): string {
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
    if (url) lines.push(`![${caption || btype}](${url})`);
  } else if (btype === "code") {
    const text = richTextPlain(payload.rich_text);
    const lang = String(payload.language ?? "");
    lines.push(`\`\`\`${lang}\n${text}\n\`\`\``);
  }

  const kids = Array.isArray(block.children) ? block.children : [];
  if (kids.length) {
    const nested = blocksToMarkdown(kids);
    if (nested) lines.push(nested);
  }

  return lines.join("\n\n");
}

/** Full page block list → Markdown string. */
export function blocksToMarkdown(
  blocks: NotionBlock[] | undefined | null,
): string {
  if (!blocks?.length) return "";
  const parts = blocks.map((b) => singleBlockMarkdown(b)).filter(Boolean);
  return parts.join("\n\n");
}

/**
 * Build the full Markdown file for a page.
 * Includes YAML frontmatter + h1 heading + block body.
 */
export function pageToMarkdown(opts: {
  id: string;
  title: string | null;
  url: string | null;
  lastEditedTime: string | null;
  blocks: NotionBlock[];
}): string {
  const { id, title, url, lastEditedTime, blocks } = opts;
  const safeTitle = (title ?? "Untitled").replace(/"/g, '\\"');
  const frontmatter = [
    "---",
    `title: "${safeTitle}"`,
    `notion_id: "${id}"`,
    url ? `notion_url: "${url}"` : null,
    lastEditedTime ? `last_edited: "${lastEditedTime}"` : null,
    "---",
    "",
    `# ${title ?? "Untitled"}`,
    "",
  ]
    .filter((l) => l !== null)
    .join("\n");

  const body = blocksToMarkdown(blocks);
  return frontmatter + (body ? `${body}\n` : "");
}
