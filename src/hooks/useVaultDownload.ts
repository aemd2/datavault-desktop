import { useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

const VAULT_BUCKET = "vault-exports";
const STORAGE_PAGE_SIZE = 100;
/** Max parallel Storage downloads. */
const CONCURRENCY = 6;

/**
 * List ALL objects under a Storage prefix, paginating until exhausted.
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

/** Run `fn` over items with limited concurrency. */
async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = await Promise.all(items.slice(i, i + limit).map(fn));
    results.push(...batch);
  }
  return results;
}

export interface VaultDownloadResult {
  downloaded: number;
  failed: number;
  skipped: number;
}

/**
 * Download all vault .md files from Supabase Storage to the local
 * Electron vault folder, then optionally delete them from Storage.
 */
export async function downloadVaultToLocal(
  connectorId: string,
  options?: { deleteAfterDownload?: boolean },
): Promise<VaultDownloadResult> {
  const vault = window.electronAPI?.vault;
  if (!vault) throw new Error("Vault API not available — are you running in Electron?");

  const session = await supabase.auth.getSession();
  const uid = session.data.session?.user.id;
  if (!uid) throw new Error("Not signed in.");

  const prefix = `${uid}/${connectorId}/pages`;
  const objects = await listAllStorageObjects(prefix);

  if (objects.length === 0) {
    return { downloaded: 0, failed: 0, skipped: 0 };
  }

  let downloaded = 0;
  let failed = 0;
  let skipped = 0;
  const successPaths: string[] = [];

  await withConcurrency(objects, CONCURRENCY, async (obj) => {
    const storagePath = `${prefix}/${obj.name}`;
    const localRelPath = `${connectorId}/pages/${obj.name}`;

    try {
      const { data: blob, error } = await supabase.storage
        .from(VAULT_BUCKET)
        .download(storagePath);

      if (error || !blob) {
        failed++;
        return;
      }

      const text = await blob.text();
      await vault.saveFile(localRelPath, text);
      downloaded++;
      successPaths.push(storagePath);
    } catch {
      failed++;
    }
  });

  // Delete from Storage after confirmed local save
  if (options?.deleteAfterDownload && successPaths.length > 0) {
    try {
      // Supabase Storage remove accepts up to 100 paths at a time
      for (let i = 0; i < successPaths.length; i += 100) {
        const batch = successPaths.slice(i, i + 100);
        await supabase.storage.from(VAULT_BUCKET).remove(batch);
      }
    } catch {
      // Non-critical — files will be overwritten next sync
      console.warn("[vault] Failed to clean up Storage files after download");
    }
  }

  return { downloaded, failed, skipped };
}

/**
 * Hook that returns a callback to download vault files to the local disk.
 * Shows toast notifications for progress.
 */
export function useVaultDownload() {
  const download = useCallback(
    async (connectorId: string, opts?: { silent?: boolean; deleteAfterDownload?: boolean }) => {
      try {
        const result = await downloadVaultToLocal(connectorId, {
          deleteAfterDownload: opts?.deleteAfterDownload,
        });

        if (result.downloaded === 0 && result.failed === 0) {
          if (!opts?.silent) {
            toast.message("No vault files to download yet.");
          }
          return result;
        }

        if (!opts?.silent) {
          if (result.failed > 0) {
            toast.message(
              `Saved ${result.downloaded} pages locally (${result.failed} failed — they'll retry next sync).`,
            );
          } else {
            toast.success(
              `Saved ${result.downloaded} page${result.downloaded === 1 ? "" : "s"} to your local vault.`,
            );
          }
        }

        return result;
      } catch (err) {
        if (!opts?.silent) {
          console.error("[vault-download]", err);
          toast.error("Failed to save vault files locally. Check your connection and try again.");
        }
        return { downloaded: 0, failed: 0, skipped: 0 } as VaultDownloadResult;
      }
    },
    [],
  );

  return download;
}
