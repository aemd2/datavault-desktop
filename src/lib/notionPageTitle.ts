/**
 * Resolve Notion page titles from API-shaped JSON.
 * Notion stores the visible title in whichever property has type "title" (key varies: Name, Titre, etc.).
 * Our sync used to only check a few hard-coded keys, which produced many "Untitled" rows.
 */

import { richTextPlain } from "@/lib/notionBlocks";

/**
 * Read title from a page `properties` object (Notion API shape).
 * Picks the first non-empty `title`-type property (there is normally exactly one).
 */
export function titleFromNotionProperties(props: unknown): string | null {
  if (!props || typeof props !== "object") return null;
  const record = props as Record<string, { type?: string; title?: unknown }>;
  for (const p of Object.values(record)) {
    if (!p || typeof p !== "object") continue;
    if (p.type === "title" && Array.isArray(p.title)) {
      const s = richTextPlain(p.title).trim();
      if (s) return s;
    }
  }
  return null;
}

/**
 * Prefer the stored `title` column; if empty, derive from `raw_json` (page snapshot from Notion).
 */
export function resolvePageTitle(storedTitle: string | null | undefined, rawJson: unknown): string | null {
  const t = storedTitle?.trim();
  if (t) return t;
  if (!rawJson || typeof rawJson !== "object") return null;
  const props = (rawJson as { properties?: unknown }).properties;
  return titleFromNotionProperties(props);
}
