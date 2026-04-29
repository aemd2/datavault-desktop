import { toast } from "sonner";
import { queryClient } from "@/lib/queryClient";
import { supabase, SUPABASE_URL } from "@/lib/supabase";

/**
 * Airtable OAuth2 (PKCE) via Electron BrowserWindow — same pattern as Todoist/Asana.
 *
 * The BrowserWindow intercepts the ?code= redirect in the main process, POSTs it
 * to the Edge Function exchange endpoint, then closes. No HTML page is rendered —
 * avoids Supabase's text/plain limitation on the free tier.
 *
 * PKCE verifier/challenge is minted server-side inside the Edge Function and
 * round-tripped via a signed `state` — the desktop app never sees the verifier.
 */
export async function startAirtableOAuth(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt) {
    toast.error("Please sign in first.");
    return;
  }

  const startUrl = `${SUPABASE_URL}/functions/v1/airtable-oauth?action=start&token=${encodeURIComponent(jwt)}`;
  const exchangeUrl = `${SUPABASE_URL}/functions/v1/airtable-oauth/callback?action=exchange`;
  const callbackPath = "/functions/v1/airtable-oauth/callback";

  const isElectron = typeof window !== "undefined" && !!window.electronAPI?.oauth;

  if (isElectron) {
    toast.message("Airtable is opening…", {
      description:
        "Pick the bases you want backed up and approve read/write so DataVault can mirror records and push edits back.",
      duration: 20_000,
    });

    const result = await window.electronAPI!.oauth.connect({
      startUrl,
      exchangeUrl,
      callbackPath,
      platformName: "Airtable",
    });

    toast.dismiss();

    if (result.success) {
      void queryClient.invalidateQueries({ queryKey: ["connectors"] });
      toast.success("Airtable connected! Go to the Dashboard to run your first sync.");
    } else if (!result.cancelled) {
      toast.error(result.error ?? "Failed to connect Airtable. Please try again.");
    }
    return;
  }

  // Web fallback.
  window.location.href = startUrl;
}
