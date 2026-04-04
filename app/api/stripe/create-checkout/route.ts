// POST /api/stripe/create-checkout
// Creates a Stripe Checkout Session for the Pro plan and returns the URL.

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import Stripe from "stripe";
import { getSessionToken } from "@/lib/auth/session";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const { env } = getRequestContext();

  const token = getSessionToken(req);
  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const userId = await env.KV.get(`session:${token}`);
  if (!userId) {
    return NextResponse.json({ error: "Session expired" }, { status: 401 });
  }

  const user = await env.DB.prepare(
    `SELECT id, email, plan, stripe_customer_id FROM users WHERE id = ?`
  )
    .bind(userId)
    .first<{ id: string; email: string; plan: string; stripe_customer_id: string | null }>();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  if (user.plan === "pro") {
    return NextResponse.json({ error: "Already on Pro plan" }, { status: 400 });
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    // @ts-ignore – Fetch-based HTTP client required for Cloudflare edge
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: "2025-03-31.basil",
  });

  const appUrl = env.NEXT_PUBLIC_APP_URL ?? "https://pdfclarify.site";

  // Re-use an existing Stripe customer or create a new one
  let customerId = user.stripe_customer_id ?? undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId: user.id },
    });
    customerId = customer.id;

    await env.DB.prepare(
      `UPDATE users SET stripe_customer_id = ? WHERE id = ?`
    )
      .bind(customerId, user.id)
      .run();
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      {
        price: env.STRIPE_PRO_PRICE_ID,
        quantity: 1,
      },
    ],
    success_url: `${appUrl}/dashboard?upgrade=success`,
    cancel_url: `${appUrl}/dashboard?upgrade=cancelled`,
    metadata: { userId: user.id },
  });

  return NextResponse.json({ url: session.url });
}
