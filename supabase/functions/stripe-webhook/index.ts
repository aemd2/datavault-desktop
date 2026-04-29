/**
 * stripe-webhook — receives Stripe events and keeps subscriptions table in sync.
 *
 * Deploy with: supabase functions deploy stripe-webhook --no-verify-jwt
 * (Stripe signature replaces JWT auth)
 *
 * Required secrets:
 *   STRIPE_WEBHOOK_SECRET   whsec_...
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Handled events:
 *   checkout.session.completed       → create/upgrade subscription
 *   customer.subscription.updated   → update plan/status/period
 *   customer.subscription.deleted   → downgrade to free
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Minimal Stripe webhook signature verification (HMAC-SHA256). */
async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
): Promise<boolean> {
  try {
    const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
    const timestamp = parts["t"];
    const signature = parts["v1"];
    if (!timestamp || !signature) return false;

    const signed = `${timestamp}.${payload}`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed));
    const computed = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return computed === signature;
  } catch {
    return false;
  }
}

/** Map Stripe Price ID → plan name. Falls back to metadata.plan if set. */
function planFromPriceId(priceId: string): "managed" | "enterprise" | null {
  const managed = Deno.env.get("STRIPE_PRICE_MANAGED");
  const enterprise = Deno.env.get("STRIPE_PRICE_ENTERPRISE");
  if (managed && priceId === managed) return "managed";
  if (enterprise && priceId === enterprise) return "enterprise";
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!webhookSecret) {
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const payload = await req.text();
  const stripeSignature = req.headers.get("stripe-signature") ?? "";

  const valid = await verifyStripeSignature(payload, stripeSignature, webhookSecret);
  if (!valid) {
    return new Response("Invalid signature", { status: 400 });
  }

  const event = JSON.parse(payload);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = new Date().toISOString();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.metadata?.supabase_user_id;
        const plan = session.metadata?.plan;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        if (!userId || !plan || !customerId) break;

        // Fetch the subscription to get period end
        let periodEnd: string | null = null;
        if (subscriptionId) {
          const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
            headers: { Authorization: `Bearer ${Deno.env.get("STRIPE_SECRET_KEY")}` },
          });
          if (subRes.ok) {
            const sub = await subRes.json();
            periodEnd = sub.current_period_end
              ? new Date(sub.current_period_end * 1000).toISOString()
              : null;
          }
        }

        await admin.from("subscriptions").upsert({
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId ?? null,
          plan,
          status: "active",
          current_period_end: periodEnd,
          updated_at: now,
        });
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object;
        const userId = sub.metadata?.supabase_user_id;
        const customerId = sub.customer;

        if (!userId && !customerId) break;

        // Determine plan from price
        const priceId = sub.items?.data?.[0]?.price?.id ?? "";
        const metaPlan = sub.metadata?.plan;
        const plan = planFromPriceId(priceId) ?? metaPlan ?? "managed";

        const periodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;

        const status = ["active", "past_due", "canceled", "trialing"].includes(sub.status)
          ? sub.status
          : "active";

        // Look up user_id from customer if not in metadata
        let resolvedUserId = userId;
        if (!resolvedUserId && customerId) {
          const { data } = await admin
            .from("subscriptions")
            .select("user_id")
            .eq("stripe_customer_id", customerId)
            .maybeSingle();
          resolvedUserId = data?.user_id;
        }
        if (!resolvedUserId) break;

        await admin.from("subscriptions").upsert({
          user_id: resolvedUserId,
          stripe_customer_id: customerId,
          stripe_subscription_id: sub.id,
          plan,
          status,
          current_period_end: periodEnd,
          updated_at: now,
        });
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const customerId = sub.customer;

        const { data } = await admin
          .from("subscriptions")
          .select("user_id")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();
        if (!data?.user_id) break;

        await admin.from("subscriptions").upsert({
          user_id: data.user_id,
          stripe_customer_id: customerId,
          stripe_subscription_id: null,
          plan: "free",
          status: "canceled",
          current_period_end: null,
          updated_at: now,
        });
        break;
      }

      default:
        // Unhandled event — return 200 so Stripe doesn't retry
        break;
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Webhook handler error";
    console.error("stripe-webhook error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});
