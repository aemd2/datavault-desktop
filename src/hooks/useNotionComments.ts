import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type NotionComment = {
  id: string;
  connector_id: string;
  page_id: string;
  block_id: string | null;
  rich_text: unknown[];
  plain_text: string | null;
  created_time: string | null;
  created_by_id: string | null;
  created_by_name: string | null;
};

/**
 * Fetch all comments for a given Notion page.
 * RLS ensures only the user's own data is returned.
 */
export function useNotionComments(pageId: string | undefined) {
  return useQuery({
    queryKey: ["notion-comments", pageId],
    enabled: Boolean(pageId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notion_comments")
        .select("id, connector_id, page_id, block_id, rich_text, plain_text, created_time, created_by_id, created_by_name")
        .eq("page_id", pageId as string)
        .order("created_time", { ascending: true });

      if (error) throw error;
      return (data ?? []) as NotionComment[];
    },
  });
}
