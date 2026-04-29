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
            // sandbox: false lets third-party OAuth consent pages (e.g. Todoist)
            // load all their scripts and service workers correctly. This window
            // only ever shows a platform consent page and is destroyed immediately
            // after we intercept the callback redirect.
            sandbox: false,
          },
        });

        // Override the Electron user agent with a plain Chrome one.
        // Many OAuth consent pages (Todoist, etc.) detect "Electron" in the UA
        // and fail to bootstrap their SPA. Removing it makes the window look
        // like a standard Chrome browser to the remote server.
        const baseUA = win.webContents.getUserAgent();
        win.webContents.setUserAgent(
          baseUA.replace(/\s*Electron\/[\d.]+/, ""),
        );

        let settled = false;

        const settle = (result: StandardOAuthResult) => {
          if (settled) return;
          settled = true;
          if (!win.isDestroyed()) win.destroy();
          resolve(result);
        };

        // Intercept callback URL before the BrowserWindow makes the HTTP request.
        // OAuth codes are single-use — if the BrowserWindow loads the callback URL,
        // the Edge Function GET handler consumes the code first, and the Electron
        // POST exchange below will fail with "Token exchange failed".
        //
        // Two separate event types are needed:
        //   • will-navigate  — JS/user-initiated navigations (e.g. window.location = ...)
        //   • will-redirect  — server-side HTTP 302 redirects (fires instead of will-navigate)
        //
        // Airtable's "Confirm redirect" button triggers a server-side redirect,
        // so will-redirect is the critical one here. Both support preventDefault().

        // Returns true only when `url` is our callback page — not when our
        // callback path merely appears as a query parameter inside another URL.
        // For example, Airtable's "Confirm redirect" page URL looks like:
        //   https://airtable.com/some-path?redirect_uri=https://...supabase.co/.../callback&code=...
        // url.includes(callbackPath) would wrongly match that. Checking the
        // parsed pathname ensures we only intercept the real callback navigation.
        const isCallbackUrl = (url: string): boolean => {
          try {
            return new URL(url).pathname.includes(callbackPath);
          } catch {
            return false;
          }
        };

        const interceptCallback = (e: Electron.Event, url: string) => {
          if (!isCallbackUrl(url)) return;
          // Block the BrowserWindow from making the HTTP GET to the callback URL.
          // This ensures the auth code is only consumed once — by the POST exchange below.
          e.preventDefault();
          if (!win.isDestroyed()) win.hide();
          void handleCallback(url, exchangeUrl, settle);
        };

        // did-navigate fires AFTER the page has loaded — last-resort fallback only.
        // By this point the code may already be consumed, but settled flag prevents
        // resolving twice.
        const onDidNavigate = (_e: Electron.Event, url: string) => {
          if (!isCallbackUrl(url)) return;
          if (!win.isDestroyed()) win.hide();
          void handleCallback(url, exchangeUrl, settle);
        };

        win.webContents.on("will-navigate", interceptCallback);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        win.webContents.on("will-redirect", interceptCallback as any);
        win.webContents.on("did-navigate", onDidNavigate);
        win.webContents.on("did-navigate-in-page", onDidNavigate);

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
