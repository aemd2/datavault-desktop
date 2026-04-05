import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type NotionUser = {
  id: string;
  connector_id: string;
  name: string | null;
  avatar_url: string | null;
  email: string | null;
  user_type: string | null;
};

/**
 * Fetch all workspace users for a given connector.
 * RLS ensures only the user's own data is returned.
 */
export function useNotionUsers(connectorId?: string) {
  return useQuery({
    queryKey: ["notion-users", connectorId ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("notion_users")
        .select("id, connector_id, name, avatar_url, email, user_type")
        .order("name", { ascending: true });

      if (connectorId) {
        q = q.eq("connector_id", connectorId);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as NotionUser[];
    },
  });
}

/**
 * Build a map of user_id → user for quick lookups (e.g. resolving created_by).
 */
export function useNotionUserMap(connectorId?: string) {
  const { data: users, ...rest } = useNotionUsers(connectorId);
  const map = new Map<string, NotionUser>();
  if (users) {
    for (const u of users) map.set(u.id, u);
  }
  return { userMap: map, users, ...rest };
}
