export interface ElectronVaultAPI {
  /** Write a text file at a path relative to the local vault root. */
  saveFile(relPath: string, contents: string): Promise<void>;
  /** Read a text file from the local vault. Returns null if missing. */
  readFile(relPath: string): Promise<string | null>;
  /** Recursively list files under a vault subfolder. Returns relative paths. */
  listFiles(relPath: string): Promise<string[]>;
  /** Absolute path to the vault root (for "Open in explorer" UX). */
  getRoot(): Promise<string>;
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
}

// Augment the global Window interface so TypeScript knows about window.electronAPI
declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
