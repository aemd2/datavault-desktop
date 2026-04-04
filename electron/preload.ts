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

  app: {
    getVersion: () => ipcRenderer.invoke("app:version"),
  },
});
