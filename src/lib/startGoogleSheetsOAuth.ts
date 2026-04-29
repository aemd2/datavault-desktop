import { toast } from "sonner";
import { queryClient } from "@/lib/queryClient";
import { supabase, SUPABASE_URL } from "@/lib/supabase";

/**
 * Google Sheets OAuth2 via Electron BrowserWindow — same pattern as Todoist/Asana.
 *
 * Drive (readonly) + Sheets scopes are requested server-side via
 * `access_type=offline` + `prompt=consent` so we always get a refresh_token.
 *
 * The BrowserWindow intercepts the ?code= redirect in the main process, POSTs
 * it to the Edge Function exchange endpoint, then closes. No HTML page is
 * rendered — avoids Supabase's text/plain limitation on the free tier.
 */
export async function startGoogleSheetsOAuth(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt) {
    toast.error("Please sign in first.");
    return;
  }

  const startUrl = `${SUPABASE_URL}/functions/v1/google-sheets-oauth?action=start&token=${encodeURIComponent(jwt)}`;
  const exchangeUrl = `${SUPABASE_URL}/functions/v1/google-sheets-oauth/callback?action=exchange`;
  const callbackPath = "/functions/v1/google-sheets-oauth/callback";

  const isElectron = typeof window !== "undefined" && !!window.electronAPI?.oauth;

  if (isElectron) {
    toast.message("Google is opening…", {
      description:
        "Grant Drive (to list spreadsheets) and Sheets access so DataVault can back up cells and push edits back.",
      duration: 20_000,
    });

    const result = await window.electronAPI!.oauth.connect({
      startUrl,
      exchangeUrl,
      callbackPath,
      platformName: "Google Sheets",
    });

    toast.dismiss();

    if (result.success) {
      void queryClient.invalidateQueries({ queryKey: ["connectors"] });
      toast.success("Google Sheets connected! Go to the Dashboard to run your first sync.");
    } else if (!result.cancelled) {
      toast.error(result.error ?? "Failed to connect Google Sheets. Please try again.");
    }
    return;
  }

  // Web fallback.
  window.location.href = startUrl;
}
