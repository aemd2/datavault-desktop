import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { ConnectorRow } from "@/hooks/useConnectors";
import type { SyncJobRow } from "@/hooks/useSyncJobs";
import { useStartSync, type StartSyncArgs } from "@/hooks/useStartSync";
import { useDisconnectConnector } from "@/hooks/useDisconnectConnector";
import { WorkspaceSyncProgress } from "@/components/dashboard/WorkspaceSyncProgress";

interface ConnectorCardProps {
  connector: ConnectorRow;
  /** Latest pending/running job for this workspace (from dashboard polling). */
  activeSyncJob?: SyncJobRow;
  /** Other pending/running jobs (for a one-line queue hint under this card’s progress). */
  otherActiveBackupCount?: number;
}

/** Turn internal type codes into a short label people recognize. */
function friendlySourceLabel(type: string): string {
  const t = type.toLowerCase();
  if (t === "notion") return "Notion";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * One connected workspace: name, when it last backed up, one big "Sync" action.
 */
export const ConnectorCard = ({
  connector,
  activeSyncJob,
  otherActiveBackupCount = 0,
}: ConnectorCardProps) => {
  const { mutate: startSync, isPending } = useStartSync();
  const handleSync = (force = false) =>
    startSync({ connectorId: connector.id, force } as StartSyncArgs);
  const { mutate: disconnectConnector, isPending: disconnecting } = useDisconnectConnector();
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const syncing = Boolean(activeSyncJob);
  const isPendingRemote = activeSyncJob?.status === "pending";
  const isRunningRemote = activeSyncJob?.status === "running";

  return (
    <Card className="border-border/80 bg-card/50">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-lg font-semibold leading-tight">
          {connector.workspace_name ?? "Your workspace"}
        </CardTitle>
        <Badge variant="secondary" className="shrink-0 capitalize">
          {friendlySourceLabel(connector.type)}
        </Badge>
      </CardHeader>

      <CardContent className="text-sm text-muted-foreground space-y-4">
        <div className="space-y-1.5">
          <p>
            Connected on{" "}
            <span className="text-foreground">
              {new Date(connector.created_at).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </span>
          </p>
          {connector.last_synced_at ? (
            <p>
              Last backup:{" "}
              <span className="text-foreground font-medium">
                {new Date(connector.last_synced_at).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            </p>
          ) : (
            <p className="text-foreground text-sm">No backup yet — press the button below to run the first one.</p>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              disabled={isPending}
              onClick={() => handleSync(false)}
              title="Fetches only new and changed pages from Notion into your backup"
            >
              {isPending
                ? "Starting backup…"
                : isRunningRemote
                  ? "Backup running…"
                  : isPendingRemote
                    ? "Queued — starting soon"
                    : "Sync Now"}
            </Button>

            {/* Full re-sync: bypass skip-if-unchanged, re-copy everything. */}
            {!syncing && !isPending && connector.last_synced_at && (
              <Button
                size="sm"
                variant="ghost"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => handleSync(true)}
                title="Re-copy all pages from scratch, even ones that haven't changed"
              >
                Full re-sync
              </Button>
            )}
          </div>

          {syncing && activeSyncJob ? (
            <WorkspaceSyncProgress job={activeSyncJob} otherActiveBackupCount={otherActiveBackupCount} />
          ) : (
            <p className="text-xs text-muted-foreground leading-relaxed">
              Usually takes a few minutes. You can leave this page — progress appears here while a backup runs.
            </p>
          )}
        </div>

        {/* Let people revoke our Notion access and clear this workspace from the app (DB cascades mirrored rows). */}
        <div className="pt-1 border-t border-border/50">
          <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-muted-foreground hover:text-destructive"
                disabled={disconnecting}
              >
                {connector.type.toLowerCase() === "notion" ? "Disconnect Notion" : "Disconnect workspace"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect this workspace?</AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  <span className="block">
                    We will remove this connection and delete the copied pages and tables for{" "}
                    <strong className="text-foreground">{connector.workspace_name ?? "this workspace"}</strong> from
                    DataVault. Your original content in Notion is not deleted.
                  </span>
                  {syncing ? (
                    <span className="block text-amber-600 dark:text-amber-500">
                      A backup is queued or running — disconnecting will stop tracking it here.
                    </span>
                  ) : null}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={disconnecting}>Cancel</AlertDialogCancel>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={disconnecting}
                  onClick={() =>
                    disconnectConnector(connector.id, {
                      onSuccess: () => setDisconnectOpen(false),
                    })
                  }
                >
                  {disconnecting ? "Disconnecting…" : "Disconnect"}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
};
