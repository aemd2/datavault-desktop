export interface ElectronAPI {
  /** Register a handler for deep-link URLs (datavault://...). Returns an unsubscribe fn. */
  onDeepLink(callback: (url: string) => void): () => void;
  /** Open a URL in the OS default browser (bypasses CSP / Electron navigation). */
  openExternal(url: string): Promise<void>;
  app: {
    getVersion(): Promise<string>;
  };
}

// Augment the global Window interface so TypeScript knows about window.electronAPI
declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
