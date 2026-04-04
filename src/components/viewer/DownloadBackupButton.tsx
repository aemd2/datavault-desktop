import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { blocksFromRawJson, blocksToMarkdown } from "@/lib/notionBlocks";
import { resolvePageTitle } from "@/lib/notionPageTitle";
import { bundleBlockAssetsIntoZip, collectAssetUrlsFromBlocks } from "@/lib/notionZipAssets";
import { isLocalFirstVault } from "@/lib/dataVaultMode";

const VAULT_BUCKET = "vault-exports";
/**
 * Max parallel Storage downloads at once.
 * Capped at 4 so mobile browsers (iOS Safari) do not run out of memory
 * or have the tab killed mid-download.
 */
const STORAGE_CONCURRENCY = 4;
/** Supabase Storage list returns at most 100 items per page — loop until exhausted. */
const STORAGE_PAGE_SIZE = 100;

type PageRow = {
  id: string;
  title: string | null;
  parent_id: string | null;
  url: string | null;
  last_edited_time: string | null;
  raw_json: unknown;
};

type StructureEntry = {
  id: string;
  title: string | null;
  parent_id: string | null;
  file: string;
};

interface DownloadBackupButtonProps {
  /** When set, only pages for this connector are included in the ZIP. */
  connectorId?: string;
  disabled?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeFileBase(title: string | null, id: string): string {
  const base = (title ?? "untitled").replace(/[/\\?%*:|"<>]/g, "-").trim().slice(0, 80);
  return base || id.replace(/-/g, "").slice(0, 12);
}

/** Deduplicates .md filenames when sanitised titles collide. */
function uniqueFileBases(rows: { id: string; title: string | null; raw_json: unknown }[]): Map<string, string> {
  const usedCount = new Map<string, number>();
  const idToBase = new Map<string, string>();
  for (const r of rows) {
    const resolved = resolvePageTitle(r.title, r.raw_json);
    let base = safeFileBase(resolved, r.id);
    const n = usedCount.get(base) ?? 0;
    usedCount.set(base, n + 1);
    if (n > 0) base = `${base}-${r.id.replace(/-/g, "").slice(0, 8)}`;
    idToBase.set(r.id, base);
  }
  return idToBase;
}

/** Run `fn` over `items` with at most `limit` in-flight at once (iOS-safe). */
async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const slice = items.slice(i, i + limit);
    const batch = await Promise.all(slice.map((item, j) => fn(item, i + j)));
    results.push(...batch);
  }
  return results;
}

/**
 * List ALL objects under a Storage prefix, paginating until exhausted.
 * Supabase Storage returns at most STORAGE_PAGE_SIZE per call.
 */
async function listAllStorageObjects(prefix: string): Promise<{ name: string }[]> {
  const all: { name: string }[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage.from(VAULT_BUCKET).list(prefix, {
      limit: STORAGE_PAGE_SIZE,
      offset,
    });
    if (error) throw new Error(`Storage list failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data.filter((o) => o.name && !o.name.startsWith(".")));
    if (data.length < STORAGE_PAGE_SIZE) break;
    offset += data.length;
  }
  return all;
}

// ── Standard (Postgres) download ──────────────────────────────────────────────

async function buildZipFromDatabase(connectorId: string | undefined): Promise<{ zip: JSZip; pageCount: number }> {
  let q = supabase
    .from("notion_pages")
    .select("id, title, parent_id, url, last_edited_time, raw_json");
  if (connectorId) q = q.eq("connector_id", connectorId);

  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as PageRow[];
  if (rows.length === 0) {
    toast.message("No pages to download yet — run a backup from the dashboard first.");
    return { zip: new JSZip(), pageCount: 0 };
  }

  const zip = new JSZip();
  const pagesFolder = zip.folder("pages");
  const idToBase = uniqueFileBases(rows);

  // Collect and bundle Notion-hosted image/file URLs (best-effort; CORS may block some).
  const allAssetUrls = new Set<string>();
  for (const r of rows) {
    for (const u of collectAssetUrlsFromBlocks(blocksFromRawJson(r.raw_json))) {
      allAssetUrls.add(u);
    }
  }
  const urlList = [...allAssetUrls];
  const bundled = await bundleBlockAssetsIntoZip(zip, urlList);
  if (urlList.length > 0 && bundled.size < urlList.length) {
    toast.message(
      `Bundled ${bundled.size} of ${urlList.length} images (others stay as links — run a fresh sync if URLs expired).`,
    );
  }

  const urlRewrite = (u: string) => {
    const rel = bundled.get(u);
    return rel ? `../${rel}` : u;
  };

  const structure: StructureEntry[] = rows.map((r) => {
    const resolved = resolvePageTitle(r.title, r.raw_json);
    const base = idToBase.get(r.id) ?? safeFileBase(resolved, r.id);
    return { id: r.id, title: resolved ?? r.title, parent_id: r.parent_id, file: `pages/${base}.md` };
  });

  for (const r of rows) {
    const blocks = blocksFromRawJson(r.raw_json);
    const body = blocksToMarkdown(blocks, urlRewrite);
    const resolved = resolvePageTitle(r.title, r.raw_json);
    const base = idToBase.get(r.id) ?? safeFileBase(resolved, r.id);
    const head = [
      "---",
      `title: "${base.replace(/"/g, '\\"')}"`,
      `notion_id: "${r.id}"`,
      r.url ? `notion_url: "${r.url}"` : "",
      r.last_edited_time ? `last_edited: "${r.last_edited_time}"` : "",
      "---",
      "",
      `# ${resolved ?? r.title ?? "Untitled"}`,
      "",
    ]
      .filter(Boolean)
      .join("\n");
    // Use forward slashes in ZIP paths so Windows unzip tools agree with macOS.
    pagesFolder?.file(`${base}.md`, `${head}${body ? `${body}\n` : ""}`);
  }

  addCommonZipFiles(zip, structure);
  return { zip, pageCount: rows.length };
}

// ── Local-first (Storage) download ───────────────────────────────────────────

async function buildZipFromStorage(connectorId: string): Promise<{ zip: JSZip; pageCount: number }> {
  const session = await supabase.auth.getSession();
  const uid = session.data.session?.user.id;
  if (!uid) throw new Error("Not signed in — please refresh and try again.");

  // Fetch outline rows for structure.json (no raw_json blocks needed).
  let q = supabase
    .from("notion_pages")
    .select("id, title, parent_id, url, last_edited_time, raw_json");
  q = q.eq("connector_id", connectorId);
  const { data: metaRows, error: metaErr } = await q;
  if (metaErr) throw metaErr;
  const rows = (metaRows ?? []) as PageRow[];

  const prefix = `${uid}/${connectorId}/pages`;
  const objects = await listAllStorageObjects(prefix);

  if (objects.length === 0) {
    toast.message("No vault pages in Storage yet — run a backup from the dashboard first.");
    return { zip: new JSZip(), pageCount: 0 };
  }

  const zip = new JSZip();
  const pagesFolder = zip.folder("pages");

  let downloadedCount = 0;
  let failedCount = 0;

  // Download with limited concurrency for iOS/mobile robustness.
  await withConcurrency(objects, STORAGE_CONCURRENCY, async (obj) => {
    const storagePath = `${prefix}/${obj.name}`;
    try {
      const { data: blob, error: dlErr } = await supabase.storage
        .from(VAULT_BUCKET)
        .download(storagePath);
      if (dlErr || !blob) { failedCount++; return; }
      // obj.name is the filename in Storage (e.g. "{notionPageId}.md").
      // Use forward slashes so Windows and iOS unzip tools handle the path correctly.
      pagesFolder?.file(obj.name, blob);
      downloadedCount++;
    } catch {
      failedCount++;
    }
  });

  if (failedCount > 0) {
    toast.message(`Downloaded ${downloadedCount} pages (${failedCount} failed — retry on a stable connection).`);
  }

  // Build structure.json from DB metadata rows.
  const structure: StructureEntry[] = rows.map((r) => {
    const resolved = resolvePageTitle(r.title, r.raw_json);
    return {
      id: r.id,
      title: resolved ?? r.title,
      parent_id: r.parent_id,
      file: `pages/${r.id}.md`,
    };
  });

  addCommonZipFiles(zip, structure);
  return { zip, pageCount: downloadedCount };
}

// ── Shared ZIP footer ─────────────────────────────────────────────────────────

function addCommonZipFiles(zip: JSZip, structure: StructureEntry[]) {
  zip.file(
    "structure.json",
    JSON.stringify({ exported_at: new Date().toISOString(), pages: structure }, null, 2),
  );
  zip.file(
    "README.txt",
    [
      "DataVault backup export",
      "",
      "pages/*.md  — your notes (Markdown). Open in Obsidian, VS Code, or any text editor.",
      "assets/*    — copies of images when your browser could download them (Notion links expire).",
      "structure.json — parent page ids so you can reconstruct the hierarchy.",
      "",
      "Windows: unzip normally; all paths use forward slashes.",
      "iOS:     use Files app > unzip, or share to Obsidian / Working Copy.",
      "",
      "Run another backup from the DataVault dashboard to refresh content and image URLs.",
    ].join("\n"),
  );
}

// ── Trigger download (cross-platform: blob + <a> works on Windows and iOS) ────

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // Must be appended, clicked, and then cleaned up synchronously within the
  // user gesture on Safari/iOS — do not defer with setTimeout.
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Builds a ZIP of Markdown files + structure.json and triggers a download.
 *
 * In standard mode (VITE_DATAVAULT_LOCAL_FIRST unset): reads page bodies from
 * notion_pages.raw_json in Postgres.
 *
 * In local-first vault mode (VITE_DATAVAULT_LOCAL_FIRST=true): downloads .md
 * files from the private vault-exports Storage bucket instead.
 *
 * Both modes use the blob + <a download> pattern for Windows and iOS compatibility.
 */
export function DownloadBackupButton({ connectorId, disabled }: DownloadBackupButtonProps) {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const localFirst = isLocalFirstVault();

      if (localFirst && !connectorId) {
        toast.message("Select a workspace first to download its vault.");
        return;
      }

      const { zip, pageCount } = localFirst
        ? await buildZipFromStorage(connectorId!)
        : await buildZipFromDatabase(connectorId);

      if (pageCount === 0) return;

      const blob = await zip.generateAsync({ type: "blob" });
      const filename = `datavault-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      triggerBlobDownload(blob, filename);

      toast.success(`Downloaded ${pageCount} page${pageCount === 1 ? "" : "s"} as ZIP.`);
    } catch (e) {
      console.error(e);
      toast.error("Could not build the ZIP. Try again or refresh the page.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5 shrink-0"
      disabled={disabled || busy}
      onClick={() => void run()}
      title="Download your synced pages as Markdown files in a ZIP"
    >
      <Download className="w-4 h-4" aria-hidden />
      {busy ? "Preparing…" : "Download backup"}
    </Button>
  );
}
