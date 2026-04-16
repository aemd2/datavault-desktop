import { toast } from "sonner";
import { supabase, SUPABASE_URL } from "@/lib/supabase";

/**
 * Starts Notion OAuth: loads session JWT, then opens the Edge Function URL.
 * In Electron, uses shell.openExternal; in web, full navigation.
 */
export async function startNotionOAuth(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt) return;

  const oauthUrl = `${SUPABASE_URL}/functions/v1/notion-oauth?action=start&token=${encodeURIComponent(jwt)}`;

  const isElectron = typeof window !== "undefined" && "electronAPI" in window;
  if (isElectron && window.electronAPI?.openExternal) {
    toast.message("Notion is opening in your browser", {
      description:
        'When Notion asks which pages to share — click "Select pages" → "All pages" to back up your entire workspace. Then come back here.',
      duration: 12_000,
    });
    await window.electronAPI.openExternal(oauthUrl);
  } else {
    window.location.href = oauthUrl;
  }
}
