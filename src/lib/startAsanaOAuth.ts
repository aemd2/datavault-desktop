import { toast } from "sonner";
import { queryClient } from "@/lib/queryClient";
import { supabase, SUPABASE_URL } from "@/lib/supabase";

/**
 * Asana OAuth2 via Electron BrowserWindow — same pattern as Trello/Todoist.
 * The BrowserWindow intercepts the ?code= redirect in the main process,
 * POSTs it to the Edge Function exchange endpoint, and closes.
 * No HTML page is rendered — avoids Supabase's text/plain limitation.
 */
export async function startAsanaOAuth(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt) {
    toast.error("Please sign in first.");
    return;
  }

  const startUrl = `${SUPABASE_URL}/functions/v1/asana-oauth?action=start&token=${encodeURIComponent(jwt)}`;
  const exchangeUrl = `${SUPABASE_URL}/functions/v1/asana-oauth/callback?action=exchange`;
  const callbackPath = "/functions/v1/asana-oauth/callback";

  const isElectron = typeof window !== "undefined" && !!window.electronAPI?.oauth;

  if (isElectron) {
    toast.message("Asana is opening…", {
      description: "Approve access to your workspaces and projects so DataVault can back them up.",
      duration: 20_000,
    });

    const result = await window.electronAPI!.oauth.connect({
      startUrl,
      exchangeUrl,
      callbackPath,
      platformName: "Asana",
    });

    toast.dismiss();

    if (result.success) {
      void queryClient.invalidateQueries({ queryKey: ["connectors"] });
      toast.success("Asana connected! Go to the Dashboard to run your first sync.");
    } else if (!result.cancelled) {
      toast.error(result.error ?? "Failed to connect Asana. Please try again.");
    }
    return;
  }

  // Web fallback.
  window.location.href = startUrl;
}
