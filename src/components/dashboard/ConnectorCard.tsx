import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
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
import {
  Database,
  Kanban,
  CheckSquare,
  LayoutDashboard,
  Table,
  Sheet,
  FileText,
  HelpCircle,
  RefreshCw,
  Clock,
  HardDrive,
  AlertTriangle,
  CalendarClock,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { ConnectorRow } from "@/hooks/useConnectors";
import type { SyncJobRow } from "@/hooks/useSyncJobs";
import { supabase } from "@/lib/supabase";
import { useStartSync, type StartSyncArgs } from "@/hooks/useStartSync";
import { useDisconnectConnector } from "@/hooks/useDisconnectConnector";
import { useUpdateConnectorAutoBackup } from "@/hooks/useUpdateConnectorAutoBackup";
import { WorkspaceSyncProgress } from "@/components/dashboard/WorkspaceSyncProgress";
import { friendlySourceLabel, isLocalOnlyConnector, syncKindFromDbType } from "@/lib/connectorDisplay";

function iconForType(type: string): LucideIcon {
  const t = type.toLowerCase();
  if (t === "notion") return Database;
  if (t === "trello") return Kanban;
  if (t === "todoist") return CheckSquare;
  if (t === "asana") return LayoutDashboard;
  if (t === "airtable") return Table;
  if (t === "google-sheets") return Sheet;
  if (t === "obsidian") return FileText;
  return HelpCircle;
}

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Yesterday" : `${days}d ago`;
}

interface ConnectorCardProps {
  connector: ConnectorRow;
  activeSyncJob?: SyncJobRow;
  otherActiveBackupCount?: number;
}

export const ConnectorCard = ({
  connector,
  activeSyncJob,
  otherActiveBackupCount = 0,
}: ConnectorCardProps) => {
  const sourceLabel = friendlySourceLabel(connector.type);
  const syncKind = syncKindFromDbType(connector.type);
  const Icon = iconForType(connector.type);
  const isLocal = isLocalOnlyConnector(connector.type);
  const queryClient = useQueryClient();

  const { mutate: startSync, isPending } = useStartSync();
  const handleCloudSync = (force = false) =>
    startSync({ connectorId: connector.id, force, kind: syncKind } as StartSyncArgs);

  // Obsidian "sync" is local: recount `.md` files and bump `last_synced_at`.
  // We don't hit the run-sync Edge Function — there's nothing to fetch from a
  // cloud API. Status lives in component state; progress ends in a toast.
  const [rescanning, setRescanning] = useState(false);
  const handleLocalRescan = async () => {
    if (!connector.workspace_id) {
      toast.error("This vault has no saved folder path. Disconnect and re-add it.", { duration: 8_000 });
      return;
    }
    if (!window.electronAPI?.obsidian) {
      toast.error("Rescanning only works in the DataVault desktop app.", { duration: 6_000 });
      return;
    }
    setRescanning(true);
    try {
      const count = await window.electronAPI.obsidian.rescanVault(connector.workspace_id);
      const { error } = await supabase
        .from("connectors")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", connector.id);
      if (error) throw error;
      void queryClient.invalidateQueries({ queryKey: ["connectors"] });
      toast.success(`Rescanned — ${count} note${count === 1 ? "" : "s"} in your vault.`, { duration: 5_000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Rescan failed.";
      toast.error(msg, { duration: 8_000 });
    } finally {
      setRescanning(false);
    }
  };

  const { mutate: disconnectConnector, isPending: disconnecting } = useDisconnectConnector();
  const { mutate: updateAutoBackup, isPending: updatingAutoBackup } = useUpdateConnectorAutoBackup();
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const syncing = Boolean(activeSyncJob);
  const isPendingRemote = activeSyncJob?.status === "pending";
  const isRunningRemote = activeSyncJob?.status === "running";
  const isBusy = isLocal
    ? rescanning
    : isPending || isPendingRemote || isRunningRemote;

  const syncButtonLabel = isLocal
    ? rescanning
      ? "Rescanning…"
      : "Rescan vault"
    : isPending
      ? "Starting…"
      : isRunningRemote
        ? "Backup running…"
        : isPendingRemote
          ? "Queued…"
          : "Sync Now";

  const healthColor = (isLocal ? rescanning : syncing)
    ? "bg-blue-400 animate-pulse"
    : connector.last_synced_at
      ? "bg-emerald-400"
      : "bg-amber-400";

  const healthTitle = (isLocal ? rescanning : syncing)
    ? isLocal ? "Rescanning vault" : "Backup in progress"
    : connector.last_synced_at
      ? "Up to date"
      : "Never backed up";

  return (
    <div className="rounded-xl border border-border/80 bg-card/50 p-5 flex flex-col gap-4">

      {/* Header row: icon + name + badge + health dot */}
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
          <Icon className="w-4 h-4 text-primary" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold leading-tight truncate">
              {connector.workspace_name ?? "Your workspace"}
            </h3>
            <Badge variant="secondary" className="capitalize text-xs shrink-0">
              {sourceLabel}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            <Clock className="w-3 h-3 shrink-0" />
            {connector.last_synced_at
              ? `Last backup ${relativeTime(new Date(connector.last_synced_at))}`
              : "No backup yet"}
          </p>
        </div>

        <div
          className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 ${healthColor}`}
          title={healthTitle}
        />
      </div>

      {/* First-run nudge */}
      {!syncing && !rescanning && !connector.last_synced_at && (
        <p className="text-xs text-amber-400/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 leading-relaxed">
          {isLocal
            ? "Click Rescan vault to count the notes in your folder."
            : "Run your first backup to start protecting this workspace."}
        </p>
      )}

      {/* Obsidian vault path hint */}
      {isLocal && connector.workspace_id && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 truncate" title={connector.workspace_id}>
          <HardDrive className="w-3 h-3 shrink-0" />
          <span className="truncate">{connector.workspace_id}</span>
        </p>
      )}

      {/* Sync progress (cloud connectors only) */}
      {!isLocal && syncing && activeSyncJob && (
        <WorkspaceSyncProgress
          job={activeSyncJob}
          sourceLabel={sourceLabel}
          otherActiveBackupCount={otherActiveBackupCount}
        />
      )}

      {/* Auto-backup failure banner — only show when the most recent auto-attempt
          failed AND no successful manual sync has happened since. */}
      {!isLocal &&
        connector.auto_backup_last_error &&
        (!connector.last_synced_at ||
          (connector.auto_backup_last_attempt_at &&
            new Date(connector.auto_backup_last_attempt_at) >
              new Date(connector.last_synced_at))) && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" aria-hidden />
            <div className="text-xs text-amber-200/90 leading-relaxed">
              <span className="font-medium text-amber-300">Last auto-sync failed.</span>{" "}
              <span className="text-amber-200/70">
                {connector.auto_backup_last_error.slice(0, 160)}
              </span>{" "}
              <span className="text-amber-200/70">Try Sync Now or reconnect.</span>
            </div>
          </div>
        )}

      {/* Auto-backup toggle row (cloud connectors only — Obsidian is local) */}
      {!isLocal && (
        <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
          <CalendarClock className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground">Auto-backup weekly</p>
            <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
              {connector.auto_backup_enabled
                ? connector.auto_backup_last_attempt_at
                  ? `On — last attempt ${relativeTime(new Date(connector.auto_backup_last_attempt_at))}.`
                  : "On — first auto-sync within a week."
                : "We'll sync this workspace only when you press Sync Now."}
            </p>
          </div>
          <Switch
            checked={!!connector.auto_backup_enabled}
            disabled={updatingAutoBackup}
            onCheckedChange={(checked) =>
              updateAutoBackup({ connectorId: connector.id, enabled: checked })
            }
            aria-label="Toggle weekly auto-backup"
          />
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="default"
          className="flex-1"
          disabled={isBusy}
          onClick={() => {
            if (isLocal) {
              void handleLocalRescan();
            } else {
              handleCloudSync(false);
            }
          }}
          title={
            isLocal
              ? "Recount the Markdown notes in your vault folder"
              : `Fetch only new and changed data from ${sourceLabel}`
          }
        >
          <RefreshCw
            className={`w-3.5 h-3.5 mr-1.5 ${
              (isLocal ? rescanning : isPending || isRunningRemote) ? "animate-spin" : ""
            }`}
          />
          {syncButtonLabel}
        </Button>

        {!isLocal && !syncing && !isPending && connector.last_synced_at && (
          <Button
            size="sm"
            variant="ghost"
            className="text-xs text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => handleCloudSync(true)}
            title="Re-copy everything from scratch, even items that have not changed"
          >
            Full re-sync
          </Button>
        )}
      </div>

      {/* Disconnect */}
      <div className="border-t border-border/50 pt-3 -mt-1">
        <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
              disabled={disconnecting}
            >
              Disconnect {sourceLabel}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect this workspace?</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <span className="block">
                  We will remove this connection and delete the copied data for{" "}
                  <strong className="text-foreground">{connector.workspace_name ?? "this workspace"}</strong> from
                  DataVault. Your original content in {sourceLabel} is not deleted.
                </span>
                {syncing && (
                  <span className="block text-amber-600 dark:text-amber-500">
                    A backup is queued or running — disconnecting will stop tracking it here.
                  </span>
                )}
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
    </div>
  );
};
