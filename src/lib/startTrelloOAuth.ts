import { toast } from "sonner";
import { queryClient } from "@/lib/queryClient";
import { supabase, SUPABASE_URL } from "@/lib/supabase";

/**
 * Trello-only OAuth: Electron `BrowserWindow` + main-process token capture.
 * Intentionally **not** `openSupabaseOAuthInBrowser` — Trello returns the token
 * in a URL fragment; Supabase cannot serve the HTML shim on the default domain
 * (`text/html` → `text/plain`), so a system-browser flow cannot run the shim JS.
 *
 * Other connectors use per-app `start*OAuth.ts` files that call
 * `openSupabaseOAuthInBrowser` when a normal HTTPS / `datavault://` redirect is enough.
 */
export async function startTrelloOAuth(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt) {
    toast.error("Please sign in first.");
    return;
  }

  // URL that loads the Trello consent page (via the edge function redirect).
  const startUrl = `${SUPABASE_URL}/functions/v1/trello-oauth?action=start&token=${encodeURIComponent(jwt)}`;

  // URL the main process POSTs the token to once Trello redirects back.
  const saveUrl = `${SUPABASE_URL}/functions/v1/trello-oauth/callback?action=save`;

  const isElectron = typeof window !== "undefined" && !!window.electronAPI?.trello;

  if (isElectron) {
    // BrowserWindow approach — the popup opens inside the app.
    toast.message("Trello is opening…", {
      description: 'Approve "Read, Write, Account" access on Trello\'s page.',
      duration: 20_000,
    });

    const result = await window.electronAPI!.trello.startOAuth({ startUrl, saveUrl });

    // Dismiss the "opening" toast before showing the outcome.
    toast.dismiss();

    if (result.success) {
      // Refresh Platforms / Dashboard so "Connected" state appears without a reload.
      void queryClient.invalidateQueries({ queryKey: ["connectors"] });
      toast.success("Trello connected! Go to the Dashboard to run your first sync.");
    } else if (!result.cancelled) {
      toast.error(result.error ?? "Failed to connect Trello. Please try again.");
    }
    // If cancelled (user closed the window), show nothing — that was intentional.
    return;
  }

  // Web / non-Electron fallback: navigate directly in the current tab.
  window.location.href = startUrl;
}
