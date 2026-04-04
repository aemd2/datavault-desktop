/**
 * Stripe webhook — verify signature and handle subscription lifecycle events.
 *
 * Secrets: STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY,
 *          SERVICE_ROLE_KEY (SUPABASE_URL auto-injected)
 *
 * JWT verification is OFF (see supabase/config.toml) because Stripe does
 * not send a Supabase JWT; we verify using the Stripe webhook signature instead.
 *
 * Handled events:
 *   checkout.session.completed   → upsert subscriptions row
 *   customer.subscription.updated → update plan, status, period end
 *   customer.subscription.deleted → mark canceled, revert to free
 *   invoice.payment_failed        → mark past_due
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@12.16.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2022-11-15",
  httpClient: Stripe.createFetchHttpClient(),
});

const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

/** Map Stripe product/price metadata to our plan names. */
function planFromMetadata(metadata: Stripe.Metadata | null): string {
  return metadata?.plan ?? "managed";
}

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response(JSON.stringify({ error: "No signature", code: "SIG_MISSING" }), { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "verify failed";
    return new Response(JSON.stringify({ error: msg, code: "SIG_INVALID" }), { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey =
    Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(supabaseUrl, serviceRoleKey);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id;
      if (!userId) break;

      // Retrieve the subscription to get the current period end
      const sub = await stripe.subscriptions.retrieve(session.subscription as string);
      const plan = planFromMetadata(session.metadata);

      await db.from("subscriptions").upsert({
        user_id: userId,
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: session.subscription as string,
        plan,
        status: "active",
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      });
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      // Find the user by stripe_customer_id
      const { data: rows } = await db
        .from("subscriptions")
        .select("user_id")
        .eq("stripe_customer_id", sub.customer as string)
        .limit(1);

      if (rows && rows.length > 0) {
        const plan = planFromMetadata(sub.metadata);
        await db.from("subscriptions").update({
          plan,
          status: sub.status === "active" ? "active" : sub.status,
          stripe_subscription_id: sub.id,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        }).eq("user_id", rows[0].user_id);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await db.from("subscriptions").update({
        status: "canceled",
        plan: "free",
        stripe_subscription_id: null,
        current_period_end: null,
      }).eq("stripe_customer_id", sub.customer as string);
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      await db.from("subscriptions").update({ status: "past_due" })
        .eq("stripe_customer_id", invoice.customer as string);
      break;
    }

    default:
      break;
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
