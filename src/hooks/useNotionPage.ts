import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type NotionPageDetail = {
  id: string;
  connector_id: string;
  title: string | null;
  parent_id: string | null;
  url: string | null;
  last_edited_time: string | null;
  raw_json: Record<string, unknown> | null;
};

/**
 * One page including `raw_json` (blocks + metadata) for the reader view.
 */
export function useNotionPage(pageId: string | undefined) {
  return useQuery({
    queryKey: ["notion-page", pageId],
    enabled: Boolean(pageId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notion_pages")
        .select("id, connector_id, title, parent_id, url, last_edited_time, raw_json")
        .eq("id", pageId as string)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;
      return {
        ...data,
        raw_json: (data.raw_json as Record<string, unknown> | null) ?? null,
      } as NotionPageDetail;
    },
  });
}
