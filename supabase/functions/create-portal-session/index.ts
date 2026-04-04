/**
 * Create Stripe Billing Portal Session — lets users manage their subscription.
 *
 * Requires Supabase JWT (verify_jwt = true).
 * Returns: { url: string } — frontend window.location = url
 *
 * Secrets: STRIPE_SECRET_KEY, SERVICE_ROLE_KEY, FRONTEND_URL (SUPABASE_URL auto-injected)
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey =
    Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const frontendUrl = Deno.env.get("FRONTEND_URL") ?? "http://localhost:5173";

  const client = createClient(supabaseUrl, serviceRoleKey);

  // Verify JWT and get user
  const { data: userData, error: authError } = await client.auth.getUser(jwt);
  if (authError || !userData?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }
  const userId = userData.user.id;

  // Look up Stripe customer ID from subscriptions table
  const { data: sub, error: subError } = await client
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .single();

  if (subError || !sub?.stripe_customer_id) {
    return new Response(
      JSON.stringify({ error: "No active subscription found. Please subscribe first." }),
      { status: 404, headers: corsHeaders },
    );
  }

  // Create Stripe billing portal session
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${frontendUrl}/billing`,
  });

  return new Response(
    JSON.stringify({ url: portalSession.url }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
