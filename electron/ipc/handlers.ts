import { ipcMain, app } from "electron";
import path from "path";
import fs from "fs/promises";
import { registerTrelloAuthHandler } from "./trelloAuth";
import { registerStandardOAuthHandler } from "./standardOAuth";

/**
 * Resolve a caller-provided relative path against the user's vault folder.
 * Rejects anything that escapes the vault root (path traversal guard).
 */
function resolveVaultPath(relPath: string): string {
  const vaultRoot = path.join(app.getPath("userData"), "vault");
  const target = path.resolve(vaultRoot, relPath);
  if (!target.startsWith(vaultRoot + path.sep) && target !== vaultRoot) {
    throw new Error("Invalid vault path");
  }
  return target;
}

export function registerIpcHandlers(): void {
  ipcMain.handle("app:version", () => app.getVersion());

  // Trello OAuth via BrowserWindow — avoids Supabase's HTML-serving restriction.
  registerTrelloAuthHandler();
  // Generic standard OAuth2 code-flow handler (Todoist, Asana, Airtable, Google Sheets).
  registerStandardOAuthHandler();

  // Write a text file inside the local vault folder (userData/vault/...).
  ipcMain.handle("vault:saveFile", async (_event, relPath: string, contents: string) => {
    const target = resolveVaultPath(relPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
  });

  // Read a text file from the local vault folder. Returns null if missing.
  ipcMain.handle("vault:readFile", async (_event, relPath: string): Promise<string | null> => {
    const target = resolveVaultPath(relPath);
    try {
      return await fs.readFile(target, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  });

  // List files (recursively) under a vault subfolder. Returns relative paths.
  ipcMain.handle("vault:listFiles", async (_event, relPath: string): Promise<string[]> => {
    const target = resolveVaultPath(relPath);
    const results: string[] = [];
    async function walk(dir: string, prefix: string): Promise<void> {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        throw err;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(full, rel);
        } else if (entry.isFile()) {
          results.push(rel);
        }
      }
    }
    await walk(target, "");
    return results;
  });

  // Absolute vault root (for "Open in explorer" UX).
  ipcMain.handle("vault:getRoot", () => path.join(app.getPath("userData"), "vault"));
}
