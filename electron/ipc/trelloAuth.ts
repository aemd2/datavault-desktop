import { BrowserWindow, ipcMain } from "electron";

/**
 * Trello OAuth via BrowserWindow — bypasses Supabase's HTML restriction.
 *
 * Background: Supabase edge functions rewrite `text/html` responses to
 * `text/plain` unless you have a custom domain (Pro plan). That means
 * the JS shim page approach (where a callback page reads #token= from the
 * hash and POSTs it back) silently fails — the browser shows raw HTML and
 * the script never runs.
 *
 * The correct Electron approach:
 *   1. Open a small BrowserWindow to the Supabase start URL.
 *   2. The start URL redirects to Trello's consent page.
 *   3. After the user approves, Trello redirects to our callback URL with
 *      the token in the URL fragment: ...callback?state=<jwt>#token=<trelloToken>
 *   4. We intercept `did-navigate` in the main process, extract the token
 *      directly from the URL, and POST it to the edge function's save endpoint.
 *   5. No HTML needed — the edge function's action=save is a plain HTTP POST.
 */

// Matches the callback path used by the trello-oauth edge function.
const CALLBACK_PATH = "/functions/v1/trello-oauth/callback";

export type TrelloAuthResult =
  | { success: true }
  | { success: false; error: string; cancelled?: true };

/**
 * Register the IPC handler for `trello:start-oauth`.
 *
 * Renderer calls: window.electronAPI.trello.startOAuth({ startUrl, saveUrl })
 *   - startUrl: Supabase edge function start URL (includes the Supabase JWT)
 *   - saveUrl:  Supabase edge function save URL (...callback?action=save)
 */
export function registerTrelloAuthHandler(): void {
  ipcMain.handle(
    "trello:start-oauth",
    (
      _event,
      { startUrl, saveUrl }: { startUrl: string; saveUrl: string },
    ): Promise<TrelloAuthResult> => {
      return new Promise((resolve) => {
        // Small popup-sized window — just enough for Trello's consent page.
        const win = new BrowserWindow({
          width: 560,
          height: 680,
          title: "Connect Trello — DataVault",
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });

        let settled = false;

        // Resolve once and destroy the window.
        const settle = (result: TrelloAuthResult) => {
          if (settled) return;
          settled = true;
          if (!win.isDestroyed()) win.destroy();
          resolve(result);
        };

        /**
         * Intercept navigation events.
         * When Trello redirects to our callback URL, the full URL including
         * the fragment (#token=...) is available in the event.
         */
        const onNavigate = (_e: Electron.Event, url: string) => {
          if (!url.includes(CALLBACK_PATH)) return;

          // Hide window immediately — the page shows as text/plain (Supabase
          // limitation on free plan), so there's nothing useful to display.
          if (!win.isDestroyed()) win.hide();

          handleCallback(url, saveUrl, settle);
        };

        win.webContents.on("did-navigate", onNavigate);
        // Also cover in-page navigations just in case.
        win.webContents.on("did-navigate-in-page", onNavigate);

        // User closed the popup before finishing.
        win.on("closed", () => {
          settle({ success: false, error: "Window closed before completing OAuth.", cancelled: true });
        });

        win.loadURL(startUrl);
      });
    },
  );
}

/**
 * Extract token from the callback URL, then POST it to the save endpoint.
 * Called from inside `did-navigate` after we've confirmed the URL is our
 * Trello callback.
 */
async function handleCallback(
  url: string,
  saveUrl: string,
  settle: (r: TrelloAuthResult) => void,
): Promise<void> {
  // URL looks like: ...callback?state=<jwt>#token=<trelloToken>
  // or with denied access: ...callback?state=<jwt>#token=&error=<msg>
  const hashMatch = url.match(/#token=([^&\s]*)/);
  const trelloToken = hashMatch?.[1];

  if (!trelloToken) {
    // Either the user denied access or the token is missing.
    const errorMatch = url.match(/[#&]error=([^&\s]+)/);
    const reason = errorMatch ? decodeURIComponent(errorMatch[1]) : "No token returned.";
    settle({ success: false, error: `Trello did not grant access: ${reason}` });
    return;
  }

  // Extract state (Supabase JWT) from query params.
  let state = "";
  try {
    state = new URL(url).searchParams.get("state") ?? "";
  } catch {
    // If URL parsing fails, state stays empty and the edge function will reject.
  }

  // POST the token to the Supabase edge function's save endpoint.
  // This is a plain HTTP POST — no HTML serving required.
  try {
    const body = new URLSearchParams({ trello_token: trelloToken, state });
    const resp = await fetch(saveUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (resp.ok) {
      settle({ success: true });
    } else {
      // Read the response body for a useful error message.
      const text = await resp.text().catch(() => `HTTP ${resp.status}`);
      // The edge function returns an HTML error page — strip tags for readability.
      const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
      settle({ success: false, error: plain || `Save failed (HTTP ${resp.status}).` });
    }
  } catch (err) {
    settle({ success: false, error: `Network error: ${String(err)}` });
  }
}
