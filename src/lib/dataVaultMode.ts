/**
 * Local-first vault mode flag.
 *
 * When VITE_DATAVAULT_LOCAL_FIRST=true (must match the Edge secret
 * DATAVAULT_STORE_FULL_PAYLOAD=false), page bodies live in Supabase Storage
 * under vault-exports/{userId}/{connectorId}/pages/{pageId}.md
 * instead of in notion_pages.raw_json.
 *
 * The viewer can still show page outlines (title, parent, url) from the DB.
 * Full page text is only available via the Download backup ZIP.
 */
export function isLocalFirstVault(): boolean {
  return import.meta.env.VITE_DATAVAULT_LOCAL_FIRST === "true";
}
