import { BrowserWindow, ipcMain } from "electron";

/**
 * Generic Electron BrowserWindow handler for standard OAuth2 authorization-code flow.
 *
 * Works the same way as `trelloAuth.ts` but for platforms that return the code
 * as a query parameter (?code=...) instead of a URL fragment (#token=...).
 *
 * Flow:
 *   1. Open a small BrowserWindow to the start URL (Supabase Edge Function start).
 *   2. Edge Function redirects to the platform's consent page.
 *   3. User approves → platform redirects to our callback URL with ?code=...&state=...
 *   4. Main process intercepts did-navigate, extracts code + state from the URL.
 *   5. POSTs to the Edge Function's exchange endpoint with {code, state}.
 *   6. Edge Function exchanges code for access token, upserts connector, returns JSON.
 *   7. Window closes, promise resolves with success/failure.
 *
 * No HTML page is ever rendered — avoids the Supabase text/plain limitation.
 */

export interface StandardOAuthArgs {
  /** URL that starts the OAuth flow (Supabase Edge Function ?action=start). */
  startUrl: string;
  /**
   * URL the Edge Function exchange endpoint listens on.
   * Receives POST {code, state} and returns JSON {success, error?}.
   */
  exchangeUrl: string;
  /** Path fragment that identifies the callback URL (e.g. "/todoist-oauth/callback"). */
  callbackPath: string;
  /** Human label for the window title. */
  platformName: string;
}

export type StandardOAuthResult =
  | { success: true }
  | { success: false; error: string; cancelled?: true };

export function registerStandardOAuthHandler(): void {
  ipcMain.handle(
    "standard-oauth:connect",
    (
      _event,
      { startUrl, exchangeUrl, callbackPath, platformName }: StandardOAuthArgs,
    ): Promise<StandardOAuthResult> => {
      return new Promise((resolve) => {
        const win = new BrowserWindow({
          width: 560,
          height: 700,
          title: `Connect ${platformName} — DataVault`,
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            // sandbox: false is required so third-party OAuth consent pages
            // (e.g. Todoist) can load their scripts and stylesheets correctly.
            // The window only ever loads the platform's own consent page and is
            // destroyed immediately after we intercept the callback redirect.
            sandbox: false,
          },
        });

        let settled = false;

        const settle = (result: StandardOAuthResult) => {
          if (settled) return;
          settled = true;
          if (!win.isDestroyed()) win.destroy();
          resolve(result);
        };

        const onNavigate = (_e: Electron.Event, url: string) => {
          if (!url.includes(callbackPath)) return;

          // Hide immediately — nothing useful to show.
          if (!win.isDestroyed()) win.hide();

          void handleCallback(url, exchangeUrl, settle);
        };

        win.webContents.on("did-navigate", onNavigate);
        win.webContents.on("did-navigate-in-page", onNavigate);

        win.on("closed", () => {
          settle({ success: false, error: "Window closed before completing OAuth.", cancelled: true });
        });

        win.loadURL(startUrl);
      });
    },
  );
}

async function handleCallback(
  url: string,
  exchangeUrl: string,
  settle: (r: StandardOAuthResult) => void,
): Promise<void> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    settle({ success: false, error: "Could not parse callback URL." });
    return;
  }

  const code = parsedUrl.searchParams.get("code");
  const state = parsedUrl.searchParams.get("state") ?? "";
  const error = parsedUrl.searchParams.get("error");

  if (error) {
    settle({ success: false, error: `Platform denied access: ${error}` });
    return;
  }

  if (!code) {
    settle({ success: false, error: "No authorization code returned." });
    return;
  }

  try {
    const body = new URLSearchParams({ code, state });
    const resp = await fetch(exchangeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (resp.ok) {
      settle({ success: true });
    } else {
      const text = await resp.text().catch(() => `HTTP ${resp.status}`);
      // Strip any HTML tags from error page.
      const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
      settle({ success: false, error: plain || `Exchange failed (HTTP ${resp.status}).` });
    }
  } catch (err) {
    settle({ success: false, error: `Network error: ${String(err)}` });
  }
}
