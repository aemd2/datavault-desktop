import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type NotionDatabaseRow = {
  id: string;
  connector_id: string;
  title: string | null;
  row_count?: number;
};

/**
 * Fetch all synced Notion databases for the current user.
 * RLS on notion_databases ensures only the user's own rows are returned.
 *
 * Optional connectorId filter narrows results to one connector.
 */
export function useNotionDatabases(connectorId?: string) {
  return useQuery({
    queryKey: ["notion-databases", connectorId ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("notion_databases")
        .select("id, connector_id, title");

      if (connectorId) {
        q = q.eq("connector_id", connectorId);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as NotionDatabaseRow[];
    },
  });
}
