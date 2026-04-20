import { toast } from "sonner";
import { supabase, SUPABASE_URL } from "@/lib/supabase";
import type { ConnectorKind } from "@/lib/connectorKinds";

export interface OpenSupabaseOAuthInBrowserOptions {
  kind: ConnectorKind;
  /** Shown while the system browser opens (Electron) or before navigation (web). */
  toastTitle: string;
  toastDescription?: string;
  toastDurationMs?: number;
}

/**
 * Standard OAuth2-style start: open the `<kind>-oauth` Edge Function URL.
 * Works when the provider redirects to HTTPS or `datavault://` without relying
 * on an HTML shim on the Supabase default domain (unlike Trello fragment flow).
 *
 * Trello does **not** use this — see `startTrelloOAuth.ts` (in-app BrowserWindow).
 */
export async function openSupabaseOAuthInBrowser(options: OpenSupabaseOAuthInBrowserOptions): Promise<void> {
  const { kind, toastTitle, toastDescription, toastDurationMs = 12_000 } = options;

  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt) {
    toast.error("Please sign in first.");
    return;
  }

  const oauthUrl = `${SUPABASE_URL}/functions/v1/${kind}-oauth?action=start&token=${encodeURIComponent(jwt)}`;

  const isElectron = typeof window !== "undefined" && !!window.electronAPI?.openExternal;
  if (isElectron) {
    toast.message(toastTitle, {
      description: toastDescription,
      duration: toastDurationMs,
    });
    await window.electronAPI!.openExternal(oauthUrl);
    return;
  }

  window.location.href = oauthUrl;
}
