import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { resolvePageTitle } from "@/lib/notionPageTitle";

export type NotionPageRow = {
  id: string;
  connector_id: string;
  title: string | null;
  parent_id: string | null;
  last_edited_time: string | null;
  url: string | null;
  created_time: string | null;
  created_by_id: string | null;
  last_edited_by_id: string | null;
  icon_emoji: string | null;
  cover_url: string | null;
};

type PageRowRaw = NotionPageRow & { notion_properties?: unknown };

/**
 * Fetch all synced Notion pages for the current user.
 * RLS on notion_pages ensures only the user's own rows are returned.
 *
 * Optional connectorId filter narrows results to one connector.
 * Pulls `raw_json->properties` (small) so we can fix titles when the stored column was wrong before sync fixes.
 */
export function useNotionPages(connectorId?: string) {
  return useQuery({
    queryKey: ["notion-pages", connectorId ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("notion_pages")
        .select("id, connector_id, title, parent_id, last_edited_time, url, created_time, created_by_id, last_edited_by_id, icon_emoji, cover_url, notion_properties:raw_json->properties")
        .order("last_edited_time", { ascending: false });

      if (connectorId) {
        q = q.eq("connector_id", connectorId);
      }

      let { data, error } = await q;
      // Older PostgREST may reject JSON path in select — fall back without title repair from properties.
      if (error) {
        let qBasic = supabase
          .from("notion_pages")
          .select("id, connector_id, title, parent_id, last_edited_time, url, created_time, created_by_id, last_edited_by_id, icon_emoji, cover_url")
          .order("last_edited_time", { ascending: false });
        if (connectorId) qBasic = qBasic.eq("connector_id", connectorId);
        const retry = await qBasic;
        if (retry.error) throw retry.error;
        return (retry.data ?? []) as NotionPageRow[];
      }
      const rows = (data ?? []) as PageRowRaw[];
      return rows.map((r) => {
        const { notion_properties: np, ...rest } = r;
        return {
          ...rest,
          title: resolvePageTitle(rest.title, { properties: np }) ?? rest.title,
        } satisfies NotionPageRow;
      });
    },
  });
}
