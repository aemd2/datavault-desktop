import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase";
import type { ConnectorKind } from "@/lib/connectorKinds";

/** URL of the `push-sync` Edge Function — symmetric to `run-sync`. */
const PUSH_SYNC_URL = `${SUPABASE_URL}/functions/v1/push-sync`;

export interface PushArgs {
  connectorId: string;
  kind: ConnectorKind;
  /** Platform-specific entity identifier (Notion page id, Trello card id, Airtable record id, …). */
  entityId: string;
  /** Current file contents (Markdown or CSV). Front-matter is parsed server-side. */
  contents: string;
  /**
   * Optional etag / version token recorded when the file was last synced down.
   * If the platform's current version differs, the push is aborted as a conflict.
   */
  expectedVersion?: string;
}

export type PushResult =
  | { status: "ok"; new_version?: string }
  | { status: "conflict"; remote_version: string }
  | { status: "error"; error: string };

/**
 * Push local vault edits back to the source platform via the `push-sync`
 * Edge Function. The server dispatches on `kind` to issue the right
 * platform-specific update (Notion PATCH blocks, Trello PUT card, …).
 *
 * Returns a discriminated result the UI can toast from.
 */
export async function pushToSource(args: PushArgs): Promise<PushResult> {
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt) return { status: "error", error: "Not signed in." };

  try {
    const resp = await fetch(PUSH_SYNC_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        connector_id: args.connectorId,
        connector_kind: args.kind,
        entity_id: args.entityId,
        contents: args.contents,
        expected_version: args.expectedVersion,
      }),
    });

    if (resp.status === 409) {
      const body = await resp.json().catch(() => ({}));
      return { status: "conflict", remote_version: body.remote_version ?? "unknown" };
    }

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      return { status: "error", error: body.error ?? `Server error (${resp.status})` };
    }

    const body = await resp.json();
    return { status: "ok", new_version: body.new_version };
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}
