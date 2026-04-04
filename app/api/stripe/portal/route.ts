// POST /api/stripe/portal
// Creates a Stripe Billing Portal session so the user can manage or cancel
// their subscription, and returns the redirect URL.

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
    `SELECT id, stripe_customer_id FROM users WHERE id = ?`
  )
    .bind(userId)
    .first<{ id: string; stripe_customer_id: string | null }>();

  if (!user || !user.stripe_customer_id) {
    return NextResponse.json(
      { error: "No billing account found" },
      { status: 400 }
    );
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    // @ts-ignore – Fetch-based HTTP client required for Cloudflare edge
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: "2025-03-31.basil",
  });

  const appUrl = env.NEXT_PUBLIC_APP_URL ?? "https://pdfclarify.site";

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: `${appUrl}/dashboard`,
  });

  return NextResponse.json({ url: portalSession.url });
}
