import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type SubscriptionRow = {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  /** 'free' | 'managed' | 'enterprise' */
  plan: string;
  /** 'active' | 'past_due' | 'canceled' */
  status: string;
  current_period_end: string | null;
};

/** Fallback used when no subscription row exists (free tier). */
const FREE_PLAN: SubscriptionRow = {
  user_id: "",
  stripe_customer_id: null,
  stripe_subscription_id: null,
  plan: "free",
  status: "active",
  current_period_end: null,
};

/**
 * Reads the current user's subscription from public.subscriptions.
 * Falls back to free plan if no row exists (new users, self-hosted users).
 */
export function useSubscription() {
  return useQuery({
    queryKey: ["subscription"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("user_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end")
        .maybeSingle();

      // PGRST116 = no rows — that is fine, fall through to free plan.
      if (error && error.code !== "PGRST116") throw error;
      return (data as SubscriptionRow) ?? FREE_PLAN;
    },
  });
}
