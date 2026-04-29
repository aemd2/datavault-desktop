import { openSupabaseOAuthInBrowser } from "@/lib/oauth/openSupabaseOAuthInBrowser";

/**
 * Todoist OAuth2 via the system browser.
 *
 * Why system browser (not BrowserWindow):
 *   Todoist's consent page lives at app.todoist.com which is a full React SPA.
 *   That SPA relies on Service Workers and modern browser APIs that fail to
 *   bootstrap inside an Electron BrowserWindow, producing "couldn't load
 *   the required files". Opening in the real system browser avoids this.
 *
 * Flow:
 *   1. System browser opens todoist-oauth?action=start → edge function redirects
 *      to https://todoist.com/oauth/authorize.
 *   2. User approves → Todoist sends ?code= to the Supabase callback URL.
 *   3. Edge function exchanges code, upserts connector, redirects to datavault://dashboard.
 *   4. DeepLinkHandler in App.tsx navigates to /dashboard and refreshes connectors.
 */
export async function startTodoistOAuth(): Promise<void> {
  return openSupabaseOAuthInBrowser({
    kind: "todoist",
    toastTitle: "Todoist is opening in your browser",
    toastDescription:
      "Approve access in the browser tab that just opened. The app will update automatically when done.",
    toastDurationMs: 30_000,
  });
}
