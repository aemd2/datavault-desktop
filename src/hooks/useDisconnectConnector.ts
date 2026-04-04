import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { friendlyDisconnectConnectorError } from "@/lib/friendlySyncErrors";

/**
 * Remove a connector row for the signed-in user.
 *
 * RLS policy `connectors_delete_own` only allows `user_id = auth.uid()`.
 * Foreign keys from sync_jobs and notion_* use ON DELETE CASCADE, so mirrored
 * data and job history for this workspace are removed with the connector.
 */
export function useDisconnectConnector() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (connectorId: string) => {
      const { error } = await supabase.from("connectors").delete().eq("id", connectorId);
      if (error) throw error;
    },
    onSuccess: () => {
      // Dashboard and viewer read from these keys; clear all so multi-workspace UI stays correct.
      queryClient.invalidateQueries({ queryKey: ["connectors"] });
      queryClient.invalidateQueries({ queryKey: ["sync_jobs"] });
      queryClient.invalidateQueries({ queryKey: ["notion-pages"] });
      queryClient.invalidateQueries({ queryKey: ["notion-databases"] });
      toast.success("Workspace disconnected. You can connect Notion again anytime.");
    },
    onError: (err) => {
      toast.error(friendlyDisconnectConnectorError(err), { duration: 10_000 });
    },
  });
}
