import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type ConnectorRow = {
  id: string;
  user_id: string;
  type: string;
  workspace_name: string | null;
  created_at: string;
  last_synced_at: string | null;
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
        .select("id, user_id, type, workspace_name, created_at, last_synced_at")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as ConnectorRow[];
    },
  });
}
