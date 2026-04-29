/**
 * ConnectorLimitDialog — shown when a Free user tries to add a 2nd cloud connector.
 *
 * Two paths out:
 *   • Disconnect existing → goes to Dashboard so they can use the Disconnect
 *     button on a connector card (defined in ConnectorCard.tsx).
 *   • Upgrade plan → goes to Billing → Stripe checkout for Managed/Enterprise.
 *
 * Obsidian is always free — never triggers this dialog (handled by callers).
 */

import { useNavigate } from "react-router-dom";
import { Lock, ArrowRight, Unplug, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConnectorLimitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display name of the cloud connector the user already has (e.g. "Notion"). */
  currentConnectorName?: string;
  /** Plan label — defaults to "Free". */
  planName?: string;
  /** Limit number — defaults to 1. */
  limit?: number;
}

export function ConnectorLimitDialog({
  open,
  onOpenChange,
  currentConnectorName,
  planName = "Free",
  limit = 1,
}: ConnectorLimitDialogProps) {
  const navigate = useNavigate();

  const goDisconnect = () => {
    onOpenChange(false);
    navigate("/dashboard");
  };

  const goUpgrade = () => {
    onOpenChange(false);
    navigate("/billing");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/25 flex items-center justify-center mb-2">
            <Lock className="w-5 h-5 text-amber-400" />
          </div>
          <DialogTitle>You're on the {planName} plan</DialogTitle>
          <DialogDescription className="leading-relaxed pt-1">
            The {planName} plan allows {limit} cloud {limit === 1 ? "connection" : "connections"}
            {currentConnectorName ? <> — and you already have <span className="font-medium text-foreground">{currentConnectorName}</span> connected</> : null}.
            <br />
            <br />
            You can either disconnect your current cloud app to switch to a different one, or upgrade to add more.
            <br />
            <br />
            <span className="text-emerald-400/90">Obsidian is always free</span> — you can connect it on top of any plan.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={goDisconnect} className="gap-2">
            <Unplug className="w-4 h-4" />
            Disconnect existing
          </Button>
          <Button onClick={goUpgrade} className="gap-2">
            <Sparkles className="w-4 h-4" />
            Upgrade plan
            <ArrowRight className="w-4 h-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
