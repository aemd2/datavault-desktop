import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type ConnectorRow = {
  id: string;
  user_id: string;
  type: string;
  workspace_name: string | null;
  /**
   * Platform-specific workspace identifier. For cloud connectors this is the
   * upstream workspace ID (Notion workspace, Trello user, etc.). For Obsidian
   * this is the absolute filesystem path to the vault folder on the user's
   * disk — the ConnectorCard uses it to call `obsidian:rescanVault`.
   */
  workspace_id: string | null;
  created_at: string;
  last_synced_at: string | null;
  /** When true, the server-side cron syncs this connector weekly. */
  auto_backup_enabled: boolean;
  /** Last error message from a server-triggered auto-backup (null when last attempt succeeded). */
  auto_backup_last_error: string | null;
  /** When the most recent auto-backup attempt finished (success or failure). */
  auto_backup_last_attempt_at: string | null;
  /** Never select access_token in the browser — omitted from select(). */
};

/**
 * Lists connectors for the signed-in user (RLS enforces ownership).
 */
export function useConnectors() {
  return useQuery({
    queryKey: ["connectors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("connectors")
        .select(
          "id, user_id, type, workspace_name, workspace_id, created_at, last_synced_at, auto_backup_enabled, auto_backup_last_error, auto_backup_last_attempt_at",
        )
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as ConnectorRow[];
    },
  });
}
