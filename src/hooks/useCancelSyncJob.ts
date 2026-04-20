import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase";
import { friendlyQueueSyncError } from "@/lib/friendlySyncErrors";

const CANCEL_SYNC_URL = `${SUPABASE_URL}/functions/v1/cancel-sync`;

/**
 * Stop a queued or running backup for the current user.
 * The cancel-sync Edge Function checks connector ownership.
 */
export function useCancelSyncJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const jwt = sessionData.session?.access_token;
      if (!jwt) throw new Error("Not signed in");

      const resp = await fetch(CANCEL_SYNC_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          apikey: SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ job_id: jobId }),
      });

      const body = (await resp.json().catch(() => ({}))) as {
        error?: string;
        details?: string;
        ok?: boolean;
        applied?: boolean;
        status?: string;
      };
      if (!resp.ok) {
        const msg = body.error ?? `Request failed (${resp.status})`;
        throw new Error(body.details ? `${msg} (${body.details})` : msg);
      }
      return { applied: body.applied === true, status: body.status };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["sync_jobs"] });
      if (!data.applied) {
        toast.message("That backup had already finished — the list is up to date.", { duration: 6000 });
        return;
      }
      toast.message("Backup stopped. You can start a new one with Sync Now anytime.", { duration: 7000 });
    },
    onError: (err) => {
      toast.error(friendlyQueueSyncError(err), { duration: 10_000 });
    },
  });
}
