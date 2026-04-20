import { contextBridge, ipcRenderer } from "electron";

// Expose a typed, narrow API to the renderer via window.electronAPI.
// The renderer has NO access to Node.js APIs — only what is explicitly listed here.
contextBridge.exposeInMainWorld("electronAPI", {
  // Deep-link listener: called when the app receives a datavault:// URL.
  // The renderer registers a callback to handle auth tokens or navigation.
  onDeepLink: (callback: (url: string) => void) => {
    ipcRenderer.on("deep-link", (_event, url: string) => callback(url));
    return () => ipcRenderer.removeAllListeners("deep-link");
  },

  // Open a URL in the system browser (used for OAuth flows like Notion)
  openExternal: (url: string) => ipcRenderer.invoke("app:open-external", url),

  // Trello OAuth via BrowserWindow — avoids Supabase's HTML-serving limitation.
  // Passes startUrl (loads the Trello consent page) and saveUrl (POSTs the token).
  trello: {
    startOAuth: (args: { startUrl: string; saveUrl: string }) =>
      ipcRenderer.invoke("trello:start-oauth", args) as Promise<{
        success: boolean;
        error?: string;
        cancelled?: true;
      }>,
  },

  // Generic standard OAuth2 code-flow (Todoist, Asana, Airtable, Google Sheets).
  // BrowserWindow intercepts the callback redirect — no HTML rendering needed.
  oauth: {
    connect: (args: { startUrl: string; exchangeUrl: string; callbackPath: string; platformName: string }) =>
      ipcRenderer.invoke("standard-oauth:connect", args) as Promise<{
        success: boolean;
        error?: string;
        cancelled?: true;
      }>,
  },

  app: {
    getVersion: () => ipcRenderer.invoke("app:version"),
  },

  // Local vault filesystem bridge. Paths are resolved against userData/vault/
  // in the main process with a path-traversal guard.
  vault: {
    saveFile: (relPath: string, contents: string) =>
      ipcRenderer.invoke("vault:saveFile", relPath, contents) as Promise<void>,
    readFile: (relPath: string) =>
      ipcRenderer.invoke("vault:readFile", relPath) as Promise<string | null>,
    listFiles: (relPath: string) =>
      ipcRenderer.invoke("vault:listFiles", relPath) as Promise<string[]>,
    getRoot: () => ipcRenderer.invoke("vault:getRoot") as Promise<string>,
  },
});
