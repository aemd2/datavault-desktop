import { ipcMain, app, dialog, BrowserWindow } from "electron";
import path from "path";
import fs from "fs/promises";
import { registerTrelloAuthHandler } from "./trelloAuth";
import { registerStandardOAuthHandler } from "./standardOAuth";

/** Path to the config file that stores the user-chosen vault location. */
const VAULT_CONFIG_PATH = path.join(app.getPath("userData"), "vault-config.json");

/** Read the stored vault root path. Returns null if the user hasn't chosen one yet. */
async function getStoredVaultRoot(): Promise<string | null> {
  try {
    const raw = await fs.readFile(VAULT_CONFIG_PATH, "utf8");
    const cfg = JSON.parse(raw) as { vaultPath?: string };
    return cfg.vaultPath ?? null;
  } catch {
    return null;
  }
}

/** Save the user-chosen vault root path to disk. */
async function saveVaultRoot(vaultPath: string): Promise<void> {
  await fs.writeFile(VAULT_CONFIG_PATH, JSON.stringify({ vaultPath }), "utf8");
}

/**
 * Resolve a caller-provided relative path against the user's vault folder.
 * Uses the user-chosen path if set; falls back to {userData}/vault.
 * Rejects anything that escapes the vault root (path traversal guard).
 */
async function resolveVaultPath(relPath: string): Promise<string> {
  const stored = await getStoredVaultRoot();
  const vaultRoot = stored ?? path.join(app.getPath("userData"), "vault");
  const target = path.resolve(vaultRoot, relPath);
  if (!target.startsWith(vaultRoot + path.sep) && target !== vaultRoot) {
    throw new Error("Invalid vault path");
  }
  return target;
}

/** Result returned to the renderer by `obsidian:pickVault`. */
interface ObsidianPickResult {
  success: boolean;
  cancelled?: true;
  error?: string;
  absolutePath?: string;
  vaultName?: string;
  markdownFileCount?: number;
}

/**
 * Recursively count `.md` files under a folder.
 * Skips `.obsidian/` and `.trash/` — those are Obsidian's own state, not notes.
 */
async function countObsidianMarkdownFiles(root: string): Promise<number> {
  let count = 0;
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".obsidian" || entry.name === ".trash") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        count++;
      }
    }
  }
  await walk(root);
  return count;
}

export function registerIpcHandlers(): void {
  ipcMain.handle("app:version", () => app.getVersion());

  // Trello OAuth via BrowserWindow — avoids Supabase's HTML-serving restriction.
  registerTrelloAuthHandler();
  // Generic standard OAuth2 code-flow handler (Todoist, Asana, Airtable, Google Sheets).
  registerStandardOAuthHandler();

  // Write a text file inside the local vault folder (userData/vault/...).
  ipcMain.handle("vault:saveFile", async (_event, relPath: string, contents: string) => {
    const target = await resolveVaultPath(relPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
  });

  // Read a text file from the local vault folder. Returns null if missing.
  ipcMain.handle("vault:readFile", async (_event, relPath: string): Promise<string | null> => {
    const target = await resolveVaultPath(relPath);
    try {
      return await fs.readFile(target, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  });

  // List files (recursively) under a vault subfolder. Returns relative paths.
  ipcMain.handle("vault:listFiles", async (_event, relPath: string): Promise<string[]> => {
    const target = await resolveVaultPath(relPath);
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

  // Absolute vault root — returns the user-chosen path if set, else default.
  ipcMain.handle("vault:getRoot", async () => {
    const stored = await getStoredVaultRoot();
    return stored ?? path.join(app.getPath("userData"), "vault");
  });

  // Returns the stored vault path (null if not yet chosen by the user).
  ipcMain.handle("vault:getStoredPath", () => getStoredVaultRoot());

  // Returns a sensible default suggestion for the vault folder (user's Documents/DataVault).
  ipcMain.handle("vault:getDefaultPath", () => {
    return path.join(app.getPath("documents"), "DataVault");
  });

  /**
   * Open a native folder picker so the user can choose where to store vault files.
   * Saves the chosen path and returns it. Returns null if the user cancelled.
   */
  ipcMain.handle("vault:choosePath", async (event): Promise<string | null> => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const result = await dialog.showOpenDialog(parentWindow!, {
      title: "Choose where DataVault saves your files",
      buttonLabel: "Use this folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const chosen = result.filePaths[0];
    await saveVaultRoot(chosen);
    return chosen;
  });

  /**
   * Native folder picker for Obsidian vaults.
   *
   * Obsidian has no cloud API, so "connecting" means pointing at a local folder
   * and validating it looks like a vault (has a `.obsidian/` subfolder).
   *
   * Returns the absolute path, vault name, and `.md` file count so the renderer
   * can create a `connectors` row and show useful stats without re-scanning.
   */
  ipcMain.handle("obsidian:pickVault", async (event): Promise<ObsidianPickResult> => {
    // Anchor the dialog to the window that fired the event so it feels modal.
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;

    const result = await dialog.showOpenDialog(parentWindow!, {
      title: "Select your Obsidian vault folder",
      buttonLabel: "Use this folder",
      properties: ["openDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, cancelled: true };
    }

    const absolutePath = result.filePaths[0];
    const vaultName = path.basename(absolutePath);

    // Validate it's an Obsidian vault — the `.obsidian/` folder is created the
    // first time Obsidian opens a folder, so its presence is a reliable signal.
    const obsidianMarker = path.join(absolutePath, ".obsidian");
    try {
      const stat = await fs.stat(obsidianMarker);
      if (!stat.isDirectory()) {
        return {
          success: false,
          error: "That folder doesn't look like an Obsidian vault (no .obsidian folder inside). Open it once in Obsidian first.",
        };
      }
    } catch {
      return {
        success: false,
        error: "That folder doesn't look like an Obsidian vault (no .obsidian folder inside). Open it once in Obsidian first.",
      };
    }

    const markdownFileCount = await countObsidianMarkdownFiles(absolutePath);

    return {
      success: true,
      absolutePath,
      vaultName,
      markdownFileCount,
    };
  });

  /** Refresh the `.md` count for an existing Obsidian vault (used by Sync Now). */
  ipcMain.handle("obsidian:rescanVault", async (_event, absolutePath: string): Promise<number> => {
    if (typeof absolutePath !== "string" || absolutePath.length === 0) {
      throw new Error("Missing vault path");
    }
    // Verify the path still exists and still has the `.obsidian/` marker — the
    // user could have moved or deleted the folder between sessions.
    const marker = path.join(absolutePath, ".obsidian");
    const stat = await fs.stat(marker).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new Error("Vault folder is missing or no longer an Obsidian vault.");
    }
    return countObsidianMarkdownFiles(absolutePath);
  });

  /**
   * List all `.md` files in an Obsidian vault.
   * Returns `{ relativePath, name }[]` sorted alphabetically — the browse panel
   * uses this to populate its file list without counting every entry.
   * Skips `.obsidian/` and `.trash/` (same as the counter above).
   */
  ipcMain.handle(
    "obsidian:listNotes",
    async (_event, absolutePath: string): Promise<{ relativePath: string; name: string }[]> => {
      if (typeof absolutePath !== "string" || absolutePath.length === 0) {
        throw new Error("Missing vault path");
      }
      const marker = path.join(absolutePath, ".obsidian");
      const stat = await fs.stat(marker).catch(() => null);
      if (!stat || !stat.isDirectory()) {
        throw new Error("Vault folder is missing or no longer an Obsidian vault.");
      }

      const notes: { relativePath: string; name: string }[] = [];
      async function walkNotes(dir: string, prefix: string): Promise<void> {
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (entry.name === ".obsidian" || entry.name === ".trash") continue;
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            await walkNotes(path.join(dir, entry.name), rel);
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
            notes.push({ relativePath: rel, name: entry.name.replace(/\.md$/i, "") });
          }
        }
      }
      await walkNotes(absolutePath, "");
      notes.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
      return notes;
    },
  );

  /**
   * Read the raw Markdown content of a single note.
   * `absolutePath` is the vault root; `relativePath` is the note's path within
   * the vault (as returned by `obsidian:listNotes`).
   * Path-traversal guard: the resolved path must stay inside absolutePath.
   */
  ipcMain.handle(
    "obsidian:readNote",
    async (_event, vaultRoot: string, relativePath: string): Promise<string> => {
      if (typeof vaultRoot !== "string" || typeof relativePath !== "string") {
        throw new Error("Invalid arguments");
      }
      const target = path.resolve(vaultRoot, relativePath);
      // Guard against path traversal
      if (!target.startsWith(path.resolve(vaultRoot) + path.sep) &&
          target !== path.resolve(vaultRoot)) {
        throw new Error("Invalid note path");
      }
      return fs.readFile(target, "utf8");
    },
  );
}
