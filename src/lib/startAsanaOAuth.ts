import { openSupabaseOAuthInBrowser } from "@/lib/oauth/openSupabaseOAuthInBrowser";

/**
 * Asana OAuth2 via the system browser.
 *
 * Why system browser (not BrowserWindow):
 *   app.asana.com is a full React SPA. After the Asana login step inside a
 *   BrowserWindow the consent/redirect flow breaks due to SPA navigation quirks
 *   and Google Sign-In popups not working in sandboxed Electron windows.
 *   Opening in the real system browser gives the user their normal Asana session
 *   and a clean consent screen.
 *
 * Flow:
 *   1. System browser opens asana-oauth?action=start → edge function redirects
 *      to https://app.asana.com/-/oauth_authorize.
 *   2. User approves → Asana sends ?code= to the Supabase callback URL.
 *   3. Edge function exchanges code, upserts connector, redirects to datavault://dashboard.
 *   4. DeepLinkHandler in App.tsx navigates to /dashboard and refreshes connectors.
 */
export async function startAsanaOAuth(): Promise<void> {
  return openSupabaseOAuthInBrowser({
    kind: "asana",
    toastTitle: "Asana is opening in your browser",
    toastDescription:
      "Sign in to Asana and approve access in the browser tab that just opened. The app will update automatically when done.",
    toastDurationMs: 30_000,
  });
}
