import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type SyncJobRow = {
  id: string;
  connector_id: string;
  status: string;
  pages_synced: number;
  /** 0–100 while running; 100 when done (set by sync engine). */
  progress_pct: number;
  progress_step: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

/**
 * Recent sync jobs for the user&apos;s connectors. RLS allows reads via connector ownership.
 */
export function useSyncJobs(connectorIds: string[]) {
  return useQuery({
    queryKey: ["sync_jobs", connectorIds],
    enabled: connectorIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sync_jobs")
        .select(
          "id, connector_id, status, pages_synced, progress_pct, progress_step, started_at, finished_at, created_at",
        )
        .in("connector_id", connectorIds)
        .order("created_at", { ascending: false })
        .limit(30);

      if (error) throw error;
      const rows = (data ?? []) as SyncJobRow[];
      return rows.map((r) => ({
        ...r,
        progress_pct: typeof r.progress_pct === "number" ? r.progress_pct : 0,
      }));
    },
    refetchInterval: (query) => {
      const rows = query.state.data as SyncJobRow[] | undefined;
      if (!rows?.length) return false;
      const busy = rows.some((j) => j.status === "pending" || j.status === "running");
      return busy ? 1500 : false;
    },
  });
}
