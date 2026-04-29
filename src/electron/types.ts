export interface ElectronVaultAPI {
  /** Write a text file at a path relative to the local vault root. */
  saveFile(relPath: string, contents: string): Promise<void>;
  /** Read a text file from the local vault. Returns null if missing. */
  readFile(relPath: string): Promise<string | null>;
  /** Recursively list files under a vault subfolder. Returns relative paths. */
  listFiles(relPath: string): Promise<string[]>;
  /** Absolute path to the vault root — user-chosen path or default. */
  getRoot(): Promise<string>;
  /** Returns the stored custom vault path, or null if not yet chosen. */
  getStoredPath(): Promise<string | null>;
  /** Returns the default suggested vault path (Documents/DataVault). */
  getDefaultPath(): Promise<string>;
  /** Opens a native folder picker, saves the choice, returns the path (or null if cancelled). */
  choosePath(): Promise<string | null>;
}

export interface ElectronAPI {
  /** Register a handler for deep-link URLs (datavault://...). Returns an unsubscribe fn. */
  onDeepLink(callback: (url: string) => void): () => void;
  /** Open a URL in the OS default browser (bypasses CSP / Electron navigation). */
  openExternal(url: string): Promise<void>;
  app: {
    getVersion(): Promise<string>;
  };
  vault: ElectronVaultAPI;
  /** Trello OAuth via BrowserWindow — avoids Supabase's HTML-serving limitation. */
  trello: {
    startOAuth(args: { startUrl: string; saveUrl: string }): Promise<{
      success: boolean;
      error?: string;
      cancelled?: true;
    }>;
  };
  /** Generic standard OAuth2 code-flow via BrowserWindow (Todoist, Asana, Airtable, Google Sheets). */
  oauth: {
    connect(args: { startUrl: string; exchangeUrl: string; callbackPath: string; platformName: string }): Promise<{
      success: boolean;
      error?: string;
      cancelled?: true;
    }>;
  };
  /**
   * Obsidian local vault bridge. Obsidian has no cloud API, so "connecting"
   * means picking a local folder. The main process validates it's a vault
   * (contains `.obsidian/`) and returns a `.md` file count for the UI.
   */
  obsidian: {
    pickVault(): Promise<{
      success: boolean;
      cancelled?: true;
      error?: string;
      /** Absolute path to the chosen folder, stored in `connectors.workspace_id`. */
      absolutePath?: string;
      /** Folder basename, stored in `connectors.workspace_name`. */
      vaultName?: string;
      /** Count of `.md` files found, excluding `.obsidian/` and `.trash/`. */
      markdownFileCount?: number;
    }>;
    /** Recount markdown files in an already-connected vault (Sync Now). */
    rescanVault(absolutePath: string): Promise<number>;
    /** List all `.md` notes in the vault as `{relativePath, name}[]`. */
    listNotes(absolutePath: string): Promise<{ relativePath: string; name: string }[]>;
    /** Read raw Markdown content of a single note. */
    readNote(vaultRoot: string, relativePath: string): Promise<string>;
  };
}

// Augment the global Window interface so TypeScript knows about window.electronAPI
declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
