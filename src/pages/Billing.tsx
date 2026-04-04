import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AuthGuard } from "@/components/AuthGuard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { useSubscription } from "@/hooks/useSubscription";

/** Base URL for Supabase Edge Functions. */
const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/** Plan definitions matching PRD pricing. */
const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "€0",
    period: "forever",
    features: [
      "1 Notion workspace",
      "Up to 500 pages synced",
      "Manual sync via CLI or dashboard",
      "Open-source sync engine",
      "Self-host anywhere",
    ],
  },
  {
    id: "managed",
    name: "Managed",
    price: "€20",
    period: "/ month",
    features: [
      "Everything in Free",
      "Managed Postgres hosting",
      "Automatic hourly sync",
      "Up to 10,000 pages",
      "Up to 3 workspaces",
      "Email alerts on sync failure",
      "Email support",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "€80",
    period: "/ month",
    features: [
      "Everything in Managed",
      "Unlimited pages & workspaces",
      "Real-time continuous sync",
      "Salesforce, HubSpot connectors",
      "Team access & white-label",
      "Priority support",
      "Dedicated onboarding",
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
  <Card className={`border-border/80 ${current ? "ring-2 ring-primary" : "bg-card/50"}`}>
    <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
      <div>
        <CardTitle className="text-base font-semibold">{plan.name}</CardTitle>
        <p className="text-2xl font-bold mt-1">
          {plan.price}
          <span className="text-sm font-normal text-muted-foreground"> {plan.period}</span>
        </p>
      </div>
      {current && <Badge variant="default">Current plan</Badge>}
    </CardHeader>
    <CardContent className="space-y-4">
      <ul className="text-sm text-muted-foreground space-y-1">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <span className="text-primary mt-0.5">✓</span>
            {f}
          </li>
        ))}
      </ul>
      {plan.id !== "free" && !current && (
        <Button
          className="w-full"
          size="sm"
          disabled={loading}
          onClick={() => onUpgrade(plan.id)}
        >
          {loading ? "Redirecting…" : `Upgrade to ${plan.name}`}
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
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start checkout.");
      setUpgrading(false);
    }
  };

  /** Open Stripe Billing Portal to manage subscription. */
  const handleManage = async () => {
    setOpeningPortal(true);
    try {
      const { url } = await callFn("create-portal-session", {});
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open billing portal.");
      setOpeningPortal(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground px-6 py-12 max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Billing</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isLoading ? "Loading plan…" : `You are on the ${currentPlan} plan.`}
          </p>
        </div>
        <div className="flex gap-2">
          {isPaid && (
            <Button variant="outline" size="sm" disabled={openingPortal} onClick={handleManage}>
              {openingPortal ? "Opening…" : "Manage subscription"}
            </Button>
          )}
          <Button variant="ghost" size="sm" asChild>
            <Link to="/dashboard">← Dashboard</Link>
          </Button>
        </div>
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
    </div>
  );
};

const Billing = () => (
  <AuthGuard>
    <BillingInner />
  </AuthGuard>
);

export default Billing;
