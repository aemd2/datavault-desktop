import { openSupabaseOAuthInBrowser } from "@/lib/oauth/openSupabaseOAuthInBrowser";

/**
 * Airtable-only OAuth2 via `airtable-oauth` Edge Function.
 */
export async function startAirtableOAuth(): Promise<void> {
  return openSupabaseOAuthInBrowser({
    kind: "airtable",
    toastTitle: "Airtable is opening in your browser",
    toastDescription:
      "On Airtable's screen, pick the bases you want backed up and approve read/write so DataVault can mirror records and push edits back.",
    toastDurationMs: 12_000,
  });
}
