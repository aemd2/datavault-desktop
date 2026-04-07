import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSubscription } from "@/hooks/useSubscription";

/** Which nav item gets the primary (gold) button — matches current page. */
export type AppNavActive = "dashboard" | "viewer" | "billing";

/** Plan label people understand at a glance. */
function planDisplayName(plan: string): string {
  const p = plan.toLowerCase();
  if (p === "free") return "Free plan";
  if (p === "managed") return "Managed";
  if (p === "enterprise") return "Enterprise";
  return plan;
}

/** Colour by tier — outline for free, stronger for paid. */
function PlanBadge({ plan }: { plan: string }) {
  const variants: Record<string, "default" | "secondary" | "outline"> = {
    free: "outline",
    managed: "secondary",
    enterprise: "default",
  };
  return (
    <Badge variant={variants[plan.toLowerCase()] ?? "outline"} className="capitalize">
      {planDisplayName(plan)}
    </Badge>
  );
}

interface AppTopNavProps {
  /** Highlights the nav action for the current area (Browse backup vs Billing). */
  active: AppNavActive;
}

/**
 * Shared top bar: logo (links to dashboard), plan badge, Browse backup, Billing, Log out.
 * Same chrome as the dashboard header — no separate “Home” control; logo returns to the hub.
 */
export function AppTopNav({ active }: AppTopNavProps) {
  const navigate = useNavigate();
  const { data: subscription } = useSubscription();
  const isElectronApp = typeof window !== "undefined" && "electronAPI" in window;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate(isElectronApp ? "/login" : "/", { replace: true });
  };

  const browseVariant = active === "dashboard" || active === "viewer" ? "default" : "outline";
  const billingVariant = active === "billing" ? "default" : "outline";
  const showDashboardBack = active !== "dashboard";

  return (
    <header className="border-b border-border/80 bg-card/30 shrink-0">
      <div className="max-w-4xl mx-auto px-6 py-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label="DataVault — back to dashboard"
          >
            <p className="font-display text-xl font-bold">
              <span className="text-foreground">Data</span>
              <span className="text-gradient-gold">Vault</span>
            </p>
            <p className="text-xs text-muted-foreground">Your backup &amp; workspaces</p>
          </button>
          {subscription ? <PlanBadge plan={subscription.plan} /> : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {showDashboardBack ? (
            <Button variant="outline" size="sm" onClick={() => navigate("/dashboard")}>
              Dashboard
            </Button>
          ) : null}
          <Button variant={browseVariant} size="sm" onClick={() => navigate("/viewer")}>
            Browse backup
          </Button>
          <Button variant={billingVariant} size="sm" onClick={() => navigate("/billing")}>
            Billing
          </Button>
          <Button variant="secondary" size="sm" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </div>
    </header>
  );
}
