import { openSupabaseOAuthInBrowser } from "@/lib/oauth/openSupabaseOAuthInBrowser";

/**
 * Notion-only OAuth: official Notion OAuth in the system browser (Electron) or
 * full navigation (web). Not shared with other connectors — each app has its
 * own starter module and copy.
 */
export async function startNotionOAuth(): Promise<void> {
  return openSupabaseOAuthInBrowser({
    kind: "notion",
    toastTitle: "Notion is opening in your browser",
    toastDescription:
      'When Notion asks which pages to share — click "Select pages" → "All pages" to back up your entire workspace. Then come back here.',
    toastDurationMs: 12_000,
  });
}
