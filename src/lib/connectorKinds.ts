/**
 * Values stored in `connectors.type` and sent to run-sync as `connector_kind`.
 * Each maps to a Supabase Edge Function named `<kind>-oauth` for OAuth start.
 */
export type ConnectorKind =
  | "notion"
  | "trello"
  | "todoist"
  | "asana"
  | "airtable"
  | "google-sheets";
