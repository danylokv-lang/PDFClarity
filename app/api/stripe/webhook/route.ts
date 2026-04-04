// POST /api/stripe/webhook
// Handles Stripe webhook events to keep the DB in sync with subscription state.
//
// Events handled:
//   checkout.session.completed         → activate Pro after initial payment
//   customer.subscription.updated      → sync plan & status on any change
//   customer.subscription.deleted      → downgrade to free on cancellation

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import Stripe from "stripe";

export const runtime = "edge";

// Map Stripe subscription status → internal plan name
function planFromStatus(status: Stripe.Subscription.Status): string {
  return status === "active" || status === "trialing" ? "pro" : "free";
}

export async function POST(req: NextRequest) {
  const { env } = getRequestContext();

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    // @ts-ignore – Fetch-based HTTP client required for Cloudflare edge
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: "2025-03-31.basil",
  });

  let event: Stripe.Event;
  try {
    // constructEventAsync is required in edge/Web Crypto environments
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook error";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription") break;

      const userId = session.metadata?.userId;
      const customerId = session.customer as string;
      const subscriptionId = session.subscription as string;

      if (!userId) break;

      // Fetch full subscription to get real status
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);

      await env.DB.prepare(`
        UPDATE users
        SET plan = ?,
            stripe_customer_id = ?,
            stripe_subscription_id = ?,
            stripe_subscription_status = ?
        WHERE id = ?
      `)
        .bind(
          planFromStatus(subscription.status),
          customerId,
          subscriptionId,
          subscription.status,
          userId
        )
        .run();
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      await env.DB.prepare(`
        UPDATE users
        SET plan = ?,
            stripe_subscription_status = ?
        WHERE stripe_customer_id = ?
      `)
        .bind(
          planFromStatus(subscription.status),
          subscription.status,
          customerId
        )
        .run();
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      await env.DB.prepare(`
        UPDATE users
        SET plan = 'free',
            stripe_subscription_id = NULL,
            stripe_subscription_status = 'canceled'
        WHERE stripe_customer_id = ?
      `)
        .bind(customerId)
        .run();
      break;
    }

    default:
      // Unhandled event types are silently ignored
      break;
  }

  return NextResponse.json({ received: true });
}
