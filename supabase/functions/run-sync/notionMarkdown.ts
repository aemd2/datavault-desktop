/**
 * Notion block tree → Markdown string (Edge/Deno runtime).
 * Kept in sync with src/lib/notionBlocks.ts (browser version).
 * Used by run-sync when DATAVAULT_STORE_FULL_PAYLOAD=false to build page .md files
 * that are uploaded to Storage instead of stored as raw_json blocks in Postgres.
 *
 * v3: sub-page content embedded inline, database rows with block content,
 *     200-row cap on inline databases, all property types supported.
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

/** Rich text with basic Markdown formatting (bold, italic, code, links). */
function richTextMarkdown(rich: unknown): string {
  if (!Array.isArray(rich)) return "";
  return rich
    .map((t) => {
      if (!t || typeof t !== "object") return "";
      const item = t as {
        plain_text?: string;
        annotations?: { bold?: boolean; italic?: boolean; strikethrough?: boolean; code?: boolean };
        href?: string | null;
        text?: { link?: { url?: string } | null };
      };
      let text = item.plain_text ?? "";
      if (!text) return "";
      const a = item.annotations ?? {};
      if (a.code) text = `\`${text}\``;
      if (a.bold) text = `**${text}**`;
      if (a.italic) text = `*${text}*`;
      if (a.strikethrough) text = `~~${text}~~`;
      const linkUrl = item.href ?? item.text?.link?.url ?? null;
      if (linkUrl) text = `[${text}](${linkUrl})`;
      return text;
    })
    .join("");
}

/** Resolve the image/file URL from a block's data payload. */
function blockAssetUrl(data: Record<string, unknown>): string {
  const file = data.file as { url?: string } | undefined;
  const external = data.external as { url?: string } | undefined;
  return external?.url ?? file?.url ?? "";
}

/** Render a Notion property value to a short string for table cells. */
export function renderProperty(prop: Record<string, unknown>): string {
  const ptype = prop.type as string ?? "";
  if (ptype === "title" || ptype === "rich_text") {
    return richTextPlain((prop[ptype] as unknown[]) ?? []) || "-";
  }
  if (ptype === "number") return prop.number != null ? String(prop.number) : "-";
  if (ptype === "select") return (prop.select as { name?: string })?.name ?? "-";
  if (ptype === "multi_select") return ((prop.multi_select as { name?: string }[]) ?? []).map((s) => s.name).join(", ") || "-";
  if (ptype === "checkbox") return prop.checkbox ? "✓" : "☐";
  if (ptype === "date") {
    const d = prop.date as { start?: string; end?: string } | null;
    if (!d?.start) return "-";
    return d.end ? `${d.start} → ${d.end}` : d.start;
  }
  if (ptype === "status") return (prop.status as { name?: string })?.name ?? "-";
  if (ptype === "url") return prop.url ? `[link](${prop.url})` : "-";
  if (ptype === "email") return (prop.email as string) ?? "-";
  if (ptype === "phone_number") return (prop.phone_number as string) ?? "-";
  if (ptype === "people") return ((prop.people as { name?: string }[]) ?? []).map((p) => p.name ?? "").filter(Boolean).join(", ") || "-";
  if (ptype === "relation") return `${((prop.relation as unknown[]) ?? []).length} linked`;
  if (ptype === "formula") {
    const f = prop.formula as Record<string, unknown> ?? {};
    const ft = f.type as string ?? "";
    return ft ? String(f[ft] ?? "-") : "-";
  }
  if (ptype === "rollup") {
    const r = prop.rollup as Record<string, unknown> ?? {};
    const rt = r.type as string ?? "";
    if (rt === "number") return r.number != null ? String(r.number) : "-";
    if (rt === "array") return `${((r.array as unknown[]) ?? []).length} items`;
    return "-";
  }
  if (ptype === "created_time") return (prop.created_time as string)?.slice(0, 10) ?? "-";
  if (ptype === "last_edited_time") return (prop.last_edited_time as string)?.slice(0, 10) ?? "-";
  if (ptype === "created_by") return (prop.created_by as { name?: string })?.name ?? "-";
  if (ptype === "last_edited_by") return (prop.last_edited_by as { name?: string })?.name ?? "-";
  return "-";
}

/** Convert one block (and its nested children) to Markdown. */
function singleBlockMarkdown(
  block: NotionBlock,
  depth = 0,
  inlineDbMap?: Map<string, string>,
  childPageMap?: Map<string, NotionBlock[]>,
): string {
  const btype = block.type ?? "";
  const payload = (block[btype] as Record<string, unknown>) ?? {};
  const lines: string[] = [];
  const indent = "  ".repeat(depth);

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
    const text = richTextMarkdown(payload.rich_text);
    const prefix: Record<string, string> = {
      heading_1: "# ",
      heading_2: "## ",
      heading_3: "### ",
      bulleted_list_item: "- ",
      numbered_list_item: "1. ",
      quote: "> ",
      callout: "> 📌 ",
    };
    if (text) lines.push(`${indent}${prefix[btype] ?? ""}${text}`);
  } else if (btype === "to_do") {
    const text = richTextMarkdown(payload.rich_text);
    const checked = Boolean(payload.checked);
    const mark = checked ? "[x]" : "[ ]";
    if (text) lines.push(`${indent}- ${mark} ${text}`);
  } else if (btype === "divider") {
    lines.push(`${indent}---`);
  } else if (btype === "image" || btype === "file") {
    const url = blockAssetUrl(payload);
    const caption = richTextPlain(payload.caption);
    if (url) lines.push(`${indent}![${caption || btype}](${url})`);
  } else if (btype === "video") {
    const url = blockAssetUrl(payload);
    const caption = richTextPlain(payload.caption);
    if (url) lines.push(`${indent}[${caption || "Video"}](${url})`);
  } else if (btype === "audio") {
    const url = blockAssetUrl(payload);
    const caption = richTextPlain(payload.caption);
    if (url) lines.push(`${indent}[${caption || "Audio"}](${url})`);
  } else if (btype === "pdf") {
    const url = blockAssetUrl(payload);
    const caption = richTextPlain(payload.caption);
    if (url) lines.push(`${indent}[${caption || "PDF"}](${url})`);
  } else if (btype === "code") {
    const text = richTextPlain(payload.rich_text);
    const lang = String(payload.language ?? "");
    const caption = richTextPlain(payload.caption);
    lines.push(`${indent}\`\`\`${lang}\n${text}\n${indent}\`\`\``);
    if (caption) lines.push(`${indent}*${caption}*`);
  } else if (btype === "equation") {
    const expr = (payload.expression as string) ?? "";
    if (expr) lines.push(`${indent}$$${expr}$$`);
  } else if (btype === "bookmark") {
    const url = (payload.url as string) ?? "";
    const caption = richTextPlain(payload.caption);
    if (url) lines.push(`${indent}[${caption || url}](${url})`);
  } else if (btype === "embed") {
    const url = (payload.url as string) ?? "";
    const caption = richTextPlain(payload.caption);
    if (url) lines.push(`${indent}[${caption || "Embed: " + url}](${url})`);
  } else if (btype === "link_preview") {
    const url = (payload.url as string) ?? "";
    if (url) lines.push(`${indent}[${url}](${url})`);
  } else if (btype === "link_to_page") {
    const pageId = (payload.page_id as string) ?? (payload.database_id as string) ?? "";
    if (pageId) lines.push(`${indent}[Link to page](notion://${pageId})`);
  } else if (btype === "child_page") {
    // Embed sub-page content inline if available, otherwise just show title.
    const title = (payload.title as string) ?? "Untitled";
    const childId = block.id as string | undefined;
    const childBlocks = childId ? childPageMap?.get(childId) : undefined;
    lines.push(`${indent}---\n${indent}## 📄 ${title}`);
    if (childBlocks && childBlocks.length > 0) {
      const childMd = blocksToMarkdown(childBlocks, 0, inlineDbMap, childPageMap);
      if (childMd) lines.push(childMd);
    }
  } else if (btype === "child_database") {
    const title = (payload.title as string) ?? "Untitled Database";
    const dbId = block.id as string | undefined;
    const inlineTable = dbId ? inlineDbMap?.get(dbId) : undefined;
    lines.push(`${indent}---\n${indent}### 🗄️ ${title}`);
    if (inlineTable) lines.push(inlineTable);
    else lines.push(`${indent}*Database — run a fresh sync to embed rows.*`);
  } else if (btype === "table") {
    // Table blocks have table_row children — render as Markdown table.
    const kids = Array.isArray(block.children) ? block.children : [];
    if (kids.length > 0) {
      const tableLines: string[] = [];
      for (let ri = 0; ri < kids.length; ri++) {
        const row = kids[ri];
        const rowPayload = (row.table_row as { cells?: unknown[][] }) ?? {};
        const cells = (rowPayload.cells ?? []).map((cell: unknown) => richTextPlain(cell));
        tableLines.push(`| ${cells.join(" | ")} |`);
        if (ri === 0) {
          tableLines.push(`| ${cells.map(() => "---").join(" | ")} |`);
        }
      }
      lines.push(tableLines.join("\n"));
      return lines.join("\n\n");
    }
  } else if (btype === "column_list") {
    const kids = Array.isArray(block.children) ? block.children : [];
    const colParts: string[] = [];
    for (const col of kids) {
      const colKids = Array.isArray(col.children) ? col.children : [];
      const colMd = blocksToMarkdown(colKids, 0, inlineDbMap, childPageMap);
      if (colMd) colParts.push(colMd);
    }
    if (colParts.length > 0) lines.push(colParts.join("\n\n---\n\n"));
    return lines.join("\n\n");
  } else if (btype === "synced_block") {
    // Just render children normally.
  } else if (btype === "table_of_contents") {
    lines.push(`${indent}*[Table of Contents]*`);
  } else if (btype === "breadcrumb") {
    // No useful content.
  }

  // Default: render children for any block type.
  const kids = Array.isArray(block.children) ? block.children : [];
  if (kids.length) {
    const nested = blocksToMarkdown(
      kids,
      depth + (btype === "bulleted_list_item" || btype === "numbered_list_item" ? 1 : 0),
      inlineDbMap,
      childPageMap,
    );
    if (nested) lines.push(nested);
  }

  return lines.join("\n\n");
}

/** Full page block list → Markdown string. */
export function blocksToMarkdown(
  blocks: NotionBlock[] | undefined | null,
  depth = 0,
  inlineDbMap?: Map<string, string>,
  childPageMap?: Map<string, NotionBlock[]>,
): string {
  if (!blocks?.length) return "";
  const parts = blocks.map((b) => singleBlockMarkdown(b, depth, inlineDbMap, childPageMap)).filter(Boolean);
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
  createdTime?: string | null;
  iconEmoji?: string | null;
  blocks: NotionBlock[];
  inlineDbMap?: Map<string, string>;
  childPageMap?: Map<string, NotionBlock[]>;
}): string {
  const { id, title, url, lastEditedTime, createdTime, iconEmoji, blocks, inlineDbMap, childPageMap } = opts;
  const safeTitle = (title ?? "Untitled").replace(/"/g, '\\"');
  const frontmatter = [
    "---",
    `title: "${safeTitle}"`,
    `notion_id: "${id}"`,
    url ? `notion_url: "${url}"` : null,
    createdTime ? `created: "${createdTime}"` : null,
    lastEditedTime ? `last_edited: "${lastEditedTime}"` : null,
    iconEmoji ? `icon: "${iconEmoji}"` : null,
    "---",
    "",
    `# ${iconEmoji ? iconEmoji + " " : ""}${title ?? "Untitled"}`,
    "",
  ]
    .filter((l) => l !== null)
    .join("\n");

  const body = blocksToMarkdown(blocks, 0, inlineDbMap, childPageMap);
  return frontmatter + (body ? `${body}\n` : "");
}
