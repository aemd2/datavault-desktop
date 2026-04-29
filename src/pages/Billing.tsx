import { useState } from "react";
import { toast } from "sonner";
import { AuthGuard } from "@/components/AuthGuard";
import { AppTopNav } from "@/components/AppTopNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase, SUPABASE_URL } from "@/lib/supabase";
import { useSubscription } from "@/hooks/useSubscription";
import { openExternalUrl } from "@/lib/marketingWeb";

/** Base URL for Supabase Edge Functions. */
const FN_BASE = `${SUPABASE_URL}/functions/v1`;

/**
 * Plan definitions aligned with PRD §5 (Free) and Phase 1 scope.
 * Only the Free tier is available in-app today; paid tiers are roadmap (Coming soon).
 */
const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "€0",
    period: "forever",
    comingSoon: false,
    features: [
      "1 Notion workspace (OAuth)",
      "Up to 1,000 pages synced",
      "Local vault: Markdown pages + JSON/CSV databases",
      "Optional sync to your Postgres (BYO) with relationships preserved",
      "Read-only viewer — browse, search, filter",
      "Ad hoc CSV/JSON exports",
      "Manual sync — CLI or dashboard",
      "Basic sync dashboard & open-source engine",
      "Community support — self-host with Docker",
    ],
  },
  {
    id: "managed",
    name: "Managed",
    price: "€20",
    period: "/ month",
    comingSoon: false,
    features: [
      "Up to 3 connected services",
      "Weekly auto-backup (scheduled)",
      "Everything in Free",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "€80",
    period: "/ month",
    comingSoon: false,
    features: [
      "Unlimited connected services",
      "Weekly auto-backup (scheduled)",
      "Priority support",
      "Everything in Managed",
    ],
  },
] as const;

/** Call an Edge Function with the current user JWT. Returns parsed JSON. */
async function callFn(path: string, body: object) {
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token ?? "";
  const res = await fetch(`${FN_BASE}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "Request failed");
  }
  return res.json();
}

// ── Sub-components ─────────────────────────────────────────────────────────

interface PlanCardProps {
  plan: (typeof PLANS)[number];
  current: boolean;
  onUpgrade: (planId: string) => void;
  loading: boolean;
}

const PlanCard = ({ plan, current, onUpgrade, loading }: PlanCardProps) => (
  <Card
    className={`border-border/80 ${current ? "ring-2 ring-primary" : "bg-card/50"} ${plan.comingSoon ? "opacity-95" : ""}`}
  >
    <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
      <div>
        <CardTitle className="text-base font-semibold">{plan.name}</CardTitle>
        <p className="text-2xl font-bold mt-1">
          {plan.price}
          <span className="text-sm font-normal text-muted-foreground"> {plan.period}</span>
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        {current && <Badge variant="default">Current plan</Badge>}
        {plan.comingSoon && !current && (
          <Badge variant="secondary">Coming soon</Badge>
        )}
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      <ul className="text-sm text-muted-foreground space-y-1">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <span className="text-primary mt-0.5">{plan.comingSoon ? "·" : "✓"}</span>
            {f}
          </li>
        ))}
      </ul>
      {/* Paid checkout opens only when the tier ships; Phase 1 is Free only. */}
      {plan.id !== "free" && !current && !plan.comingSoon && (
        <Button
          className="w-full"
          size="sm"
          disabled={loading}
          onClick={() => onUpgrade(plan.id)}
        >
          {loading ? "Redirecting…" : `Upgrade to ${plan.name}`}
        </Button>
      )}
      {plan.comingSoon && !current && (
        <Button className="w-full" size="sm" variant="secondary" disabled>
          Coming soon
        </Button>
      )}
    </CardContent>
  </Card>
);

// ── Page ───────────────────────────────────────────────────────────────────

const BillingInner = () => {
  const { data: subscription, isLoading } = useSubscription();
  const [upgrading, setUpgrading] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);

  const currentPlan = subscription?.plan ?? "free";
  const isPaid = currentPlan !== "free";

  /** Start Stripe Checkout for a paid plan. */
  const handleUpgrade = async (planId: string) => {
    setUpgrading(true);
    try {
      const { url } = await callFn("create-checkout-session", { plan: planId });
      // Use system browser in Electron (main process blocks in-window navigation to https:).
      await openExternalUrl(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start checkout.");
    } finally {
      setUpgrading(false);
    }
  };

  /** Open Stripe Billing Portal to manage subscription. */
  const handleManage = async () => {
    setOpeningPortal(true);
    try {
      const { url } = await callFn("create-portal-session", {});
      await openExternalUrl(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open billing portal.");
    } finally {
      setOpeningPortal(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <AppTopNav active="billing" />

      <main className="max-w-4xl mx-auto px-6 py-10 w-full space-y-8 flex-1">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Billing</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isLoading ? "Loading plan…" : `You are on the ${currentPlan} plan.`}
            </p>
          </div>
          {isPaid ? (
            <Button variant="outline" size="sm" disabled={openingPortal} onClick={handleManage} className="shrink-0">
              {openingPortal ? "Opening…" : "Manage subscription"}
            </Button>
          ) : null}
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              current={plan.id === currentPlan}
              onUpgrade={handleUpgrade}
              loading={upgrading}
            />
          ))}
        </div>

        {isPaid && subscription?.current_period_end && (
          <p className="text-xs text-muted-foreground text-center">
            Current period ends{" "}
            <span className="text-foreground">
              {new Date(subscription.current_period_end).toLocaleDateString()}
            </span>
            .
          </p>
        )}

        <p className="text-xs text-muted-foreground text-center">
          Payments are handled securely by Stripe. We never store your card details.
        </p>
      </main>
    </div>
  );
};

const Billing = () => (
  <AuthGuard>
    <BillingInner />
  </AuthGuard>
);

export default Billing;
