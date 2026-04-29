import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

interface UpdateArgs {
  connectorId: string;
  enabled: boolean;
}

/**
 * Toggle `connectors.auto_backup_enabled` for a workspace.
 *
 * When ON, the server-side `auto-sync-tick` cron (runs hourly) will fire
 * `run-sync` for this connector once per week. RLS policy `connectors_update_own`
 * restricts updates to the signed-in user's own rows.
 */
export function useUpdateConnectorAutoBackup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ connectorId, enabled }: UpdateArgs) => {
      const { error } = await supabase
        .from("connectors")
        .update({ auto_backup_enabled: enabled })
        .eq("id", connectorId);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["connectors"] });
      toast.success(
        vars.enabled
          ? "Auto-backup enabled — we'll sync this workspace weekly."
          : "Auto-backup turned off.",
        { duration: 4_000 },
      );
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Couldn't update auto-backup setting.";
      toast.error(msg, { duration: 8_000 });
    },
  });
}
