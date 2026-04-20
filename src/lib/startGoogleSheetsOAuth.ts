import { openSupabaseOAuthInBrowser } from "@/lib/oauth/openSupabaseOAuthInBrowser";

/**
 * Google Sheets–only OAuth2 via `google-sheets-oauth` Edge Function.
 * Drive (readonly) + Sheets scopes for discovery and two-way cell sync.
 */
export async function startGoogleSheetsOAuth(): Promise<void> {
  return openSupabaseOAuthInBrowser({
    kind: "google-sheets",
    toastTitle: "Google is opening in your browser",
    toastDescription:
      "Grant Drive (to list spreadsheets) and Sheets access so DataVault can back up cells and push edits back when you sync.",
    toastDurationMs: 12_000,
  });
}
