-- Subscriptions table: tracks each user's Stripe plan.
-- The app DB only holds billing metadata — never workspace content.

CREATE TABLE IF NOT EXISTS public.subscriptions (
  user_id             uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id  text,
  stripe_subscription_id text,
  plan                text        NOT NULL DEFAULT 'free'
                                  CHECK (plan IN ('free', 'managed', 'enterprise')),
  status              text        NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'past_due', 'canceled', 'trialing')),
  current_period_end  timestamptz,
  updated_at          timestamptz DEFAULT now()
);

-- Index for fast webhook lookups by stripe customer / subscription ID
CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_idx
  ON public.subscriptions (stripe_customer_id);
CREATE INDEX IF NOT EXISTS subscriptions_stripe_sub_idx
  ON public.subscriptions (stripe_subscription_id);

-- RLS: users can only read their own row (billing portal writes via service role)
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions_select_own"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- Stripe webhook writes via service-role key (no JWT) — policy not needed for that path.
-- But allow users to see their own row so useSubscription() works.
