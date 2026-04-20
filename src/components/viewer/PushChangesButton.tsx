import { useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { pushToSource } from "@/lib/pushToSource";
import type { ConnectorKind } from "@/lib/connectorKinds";

interface PushChangesButtonProps {
  connectorId: string;
  kind: ConnectorKind;
  entityId: string;
  /** Resolver for the current file contents — called lazily on click. */
  getContents: () => string | Promise<string>;
  /** Platform-issued version token from front-matter, for conflict detection. */
  expectedVersion?: string;
  /** Human-readable name of the platform for toast messages. */
  platformLabel?: string;
}

/**
 * "Push changes" button — read the local vault file, send it back to the
 * source platform via `push-sync`. Handles three outcomes:
 *   - ok        → success toast with latest version token
 *   - conflict  → remote moved ahead; user must re-sync first
 *   - error     → network or server failure
 */
export function PushChangesButton({
  connectorId,
  kind,
  entityId,
  getContents,
  expectedVersion,
  platformLabel,
}: PushChangesButtonProps) {
  const [busy, setBusy] = useState(false);
  const label = platformLabel ?? kind;

  const onClick = async () => {
    setBusy(true);
    try {
      const contents = await getContents();
      const result = await pushToSource({
        connectorId,
        kind,
        entityId,
        contents,
        expectedVersion,
      });

      if (result.status === "ok") {
        toast.success(`Pushed to ${label}.`);
      } else if (result.status === "conflict") {
        toast.error(
          `${label} has newer changes — re-sync your backup before pushing, to avoid overwriting them.`,
          { duration: 9000 },
        );
      } else {
        toast.error(`Couldn't push to ${label}: ${result.error}`, { duration: 9000 });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void onClick()} disabled={busy}>
      <Upload className="w-4 h-4" aria-hidden />
      {busy ? "Pushing…" : `Push to ${label}`}
    </Button>
  );
}
