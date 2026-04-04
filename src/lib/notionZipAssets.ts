/**
 * When building the backup ZIP, fetch Notion-hosted image/file URLs and store copies under assets/.
 * Notion URLs expire; local files keep the archive useful offline. Browser CORS may block some URLs —
 * those stay as remote links in the Markdown.
 */

import type { NotionBlock } from "@/lib/notionBlocks";
import type JSZip from "jszip";

function extFromContentType(ct: string | null): string {
  if (!ct) return "bin";
  const c = ct.toLowerCase();
  if (c.includes("jpeg")) return "jpg";
  if (c.includes("png")) return "png";
  if (c.includes("gif")) return "gif";
  if (c.includes("webp")) return "webp";
  if (c.includes("svg")) return "svg";
  if (c.includes("pdf")) return "pdf";
  return "bin";
}

/** Stable short name from URL so the same URL maps to one file. */
function fileSlugForUrl(url: string, index: number): string {
  let h = 2166136261;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const n = (h >>> 0).toString(16).padStart(8, "0");
  return `${n}_${index}`;
}

/**
 * Collect unique Notion file / external image URLs from a block tree (same shape as stored raw_json.blocks).
 */
export function collectAssetUrlsFromBlocks(blocks: NotionBlock[] | undefined | null): string[] {
  const seen = new Set<string>();
  const visit = (list: NotionBlock[] | undefined) => {
    if (!list?.length) return;
    for (const block of list) {
      const btype = block.type ?? "";
      const payload = (block[btype] as Record<string, unknown>) ?? {};
      if (btype === "image" || btype === "file") {
        const file = payload.file as { url?: string } | undefined;
        const external = payload.external as { url?: string } | undefined;
        const u = external?.url ?? file?.url ?? "";
        if (u) seen.add(u);
      }
      visit(Array.isArray(block.children) ? block.children : undefined);
    }
  };
  visit(blocks ?? undefined);
  return [...seen];
}

/**
 * Download each URL (best effort) into zip folder `assets/`. Returns map: original URL → path relative to ZIP root
 * (e.g. assets/abc_0.png). Markdown under pages/ should reference ../assets/...
 */
export async function bundleBlockAssetsIntoZip(
  zip: JSZip,
  urls: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (urls.length === 0) return map;

  const folder = zip.folder("assets");
  if (!folder) return map;

  const concurrency = 4;
  for (let i = 0; i < urls.length; i += concurrency) {
    const slice = urls.slice(i, i + concurrency);
    await Promise.all(
      slice.map(async (url, j) => {
        const globalIdx = i + j;
        try {
          const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" });
          if (!res.ok) return;
          const blob = await res.blob();
          const ext = extFromContentType(res.headers.get("content-type"));
          const slug = fileSlugForUrl(url, globalIdx);
          const name = `${slug}.${ext}`;
          folder.file(name, blob);
          map.set(url, `assets/${name}`);
        } catch {
          /* CORS, expired URL, or network — omit from assets */
        }
      }),
    );
  }

  return map;
}
