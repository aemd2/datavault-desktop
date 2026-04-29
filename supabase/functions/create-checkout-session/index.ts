/**
 * create-checkout-session — start a Stripe Checkout flow for a paid plan.
 *
 * Body: { plan: "managed" | "enterprise" }
 * Returns: { url: string } — open in system browser
 *
 * Required Supabase secrets:
 *   STRIPE_SECRET_KEY         sk_live_... or sk_test_... (Stripe secret key)
 *   STRIPE_PRICE_MANAGED      price_...  (€20/mo)
 *   STRIPE_PRICE_ENTERPRISE   price_...  (€80/mo)
 *   FRONTEND_URL              https://your-app-url (for success/cancel redirect)
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Read secrets inside the handler — env vars are always fresh at call time
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("Missing secret: STRIPE_SECRET_KEY not set in Supabase Edge Function secrets");

    const PRICE_MAP: Record<string, string | undefined> = {
      managed: Deno.env.get("STRIPE_PRICE_MANAGED"),
      enterprise: Deno.env.get("STRIPE_PRICE_ENTERPRISE"),
    };
    if (!PRICE_MAP.managed) throw new Error("Missing secret: STRIPE_PRICE_MANAGED not set");
    if (!PRICE_MAP.enterprise) throw new Error("Missing secret: STRIPE_PRICE_ENTERPRISE not set");

    // Authenticate user
    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const plan = String(body?.plan ?? "");
    const priceId = PRICE_MAP[plan];
    if (!priceId) {
      return new Response(JSON.stringify({ error: `Unknown or unsupported plan: "${plan}". Must be "managed" or "enterprise".` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get or create Stripe customer
    let customerId: string | null = null;
    const { data: sub } = await admin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();
    customerId = sub?.stripe_customer_id ?? null;

    if (!customerId) {
      // Create a new Stripe customer — metadata keys must be individual fields
      const custRes = await fetch("https://api.stripe.com/v1/customers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email: user.email ?? "",
          "metadata[supabase_user_id]": user.id,
        }),
      });
      const cust = await custRes.json();
      if (!custRes.ok) throw new Error(`Stripe customer error: ${cust.error?.message ?? JSON.stringify(cust)}`);
      customerId = cust.id;

      // Upsert subscription row with customer ID
      await admin.from("subscriptions").upsert({
        user_id: user.id,
        stripe_customer_id: customerId,
        plan: "free",
        status: "active",
        updated_at: new Date().toISOString(),
      });
    }

    // Success/cancel URLs — Stripe requires HTTPS URLs (custom schemes like datavault:// are rejected).
    // We use a simple Supabase redirect page, or fall back to a hosted page.
    // The Stripe webhook handles the real plan update regardless of where the user lands.
    const frontendUrl = Deno.env.get("FRONTEND_URL") ?? `${Deno.env.get("SUPABASE_URL")}/checkout-complete`;
    const successUrl = `${frontendUrl}?checkout=success&plan=${plan}`;
    const cancelUrl = `${frontendUrl}?checkout=canceled`;

    // Create Checkout Session
    const sessionRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        customer: customerId,
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": "1",
        mode: "subscription",
        success_url: successUrl,
        cancel_url: cancelUrl,
        "metadata[supabase_user_id]": user.id,
        "metadata[plan]": plan,
        "subscription_data[metadata][supabase_user_id]": user.id,
        "subscription_data[metadata][plan]": plan,
      }),
    });
    const session = await sessionRes.json();
    if (!sessionRes.ok) throw new Error(`Stripe session error: ${session.error?.message ?? JSON.stringify(session)}`);

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
