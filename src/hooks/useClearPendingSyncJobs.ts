import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { friendlyQueueSyncError } from "@/lib/friendlySyncErrors";

/**
 * Remove all `pending` sync_jobs for the given connectors (stuck "Waiting" rows).
 * Safe: completed backups (done) and failures (failed) are not deleted.
 */
export function useClearPendingSyncJobs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (connectorIds: string[]) => {
      if (connectorIds.length === 0) return { deleted: 0 };
      const { data, error } = await supabase
        .from("sync_jobs")
        .delete()
        .eq("status", "pending")
        .in("connector_id", connectorIds)
        .select("id");

      if (error) throw error;
      return { deleted: data?.length ?? 0 };
    },
    onSuccess: ({ deleted }) => {
      queryClient.invalidateQueries({ queryKey: ["sync_jobs"] });
      if (deleted === 0) {
        toast.message("No waiting rows to remove — you’re all set.");
        return;
      }
      toast.success(
        `Removed ${deleted} old waiting ${deleted === 1 ? "entry" : "entries"}. Finished backups are still listed below.`,
        { duration: 7000 },
      );
    },
    onError: (err) => {
      toast.error(friendlyQueueSyncError(err), { duration: 10_000 });
    },
  });
}
