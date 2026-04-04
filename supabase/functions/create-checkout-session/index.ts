/**
 * Create Stripe Checkout Session — called from frontend when user picks a plan.
 *
 * Requires Supabase JWT (verify_jwt = true in config.toml).
 * Body: { plan: "managed" | "enterprise" }
 * Returns: { url: string } — frontend window.location = url
 *
 * Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_MANAGED, STRIPE_PRICE_ENTERPRISE,
 *          SERVICE_ROLE_KEY, FRONTEND_URL (SUPABASE_URL is auto-injected)
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@12.16.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2022-11-15",
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Map plan name to env-var-configured Stripe price ID. */
function getPriceId(plan: string): string | null {
  if (plan === "managed") return Deno.env.get("STRIPE_PRICE_MANAGED") ?? null;
  if (plan === "enterprise") return Deno.env.get("STRIPE_PRICE_ENTERPRISE") ?? null;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: corsHeaders });
  }

  // Supabase injects the verified user when verify_jwt = true
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey =
    Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const frontendUrl = Deno.env.get("FRONTEND_URL") ?? "http://localhost:5173";

  // Verify the user JWT
  const client = createClient(supabaseUrl, serviceRoleKey);
  const { data: userData, error: authError } = await client.auth.getUser(jwt);
  if (authError || !userData?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }
  const userId = userData.user.id;
  const email = userData.user.email;

  // Parse plan from body
  let plan: string;
  try {
    const body = await req.json();
    plan = body.plan;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: corsHeaders });
  }

  const priceId = getPriceId(plan);
  if (!priceId) {
    return new Response(
      JSON.stringify({ error: `Unknown plan: ${plan}. Set STRIPE_PRICE_MANAGED or STRIPE_PRICE_ENTERPRISE env vars.` }),
      { status: 400, headers: corsHeaders },
    );
  }

  // Create Stripe Checkout session
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    customer_email: email,
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: userId,
    success_url: `${frontendUrl}/billing?success=1`,
    cancel_url: `${frontendUrl}/billing?canceled=1`,
    metadata: { user_id: userId, plan },
  });

  return new Response(
    JSON.stringify({ url: session.url }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
