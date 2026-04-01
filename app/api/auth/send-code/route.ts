// POST /api/auth/send-code
// Body: { email: string }
// Generates a 6-digit OTP, stores it in KV for 5 min, returns success.
// In production you'd email the code — for now it's returned in the response
// so you can test without an email provider set up.

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { generateOTP } from "@/lib/auth/session";

export const runtime = "edge";

const OTP_TTL = 60 * 5; // 5 minutes

export async function POST(req: NextRequest) {
  const { env } = getRequestContext();

  // Parse + validate body
  let email: string;
  try {
    const body = await req.json();
    email = (body.email ?? "").toString().toLowerCase().trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const otp = generateOTP();

  // Store OTP in KV: key = otp:<email>, value = the code, TTL = 5 min
  await env.KV.put(`otp:${email}`, otp, { expirationTtl: OTP_TTL });

  // TODO: replace with real email send (Resend / SendGrid / Cloudflare Email)
  console.log(`[DEV] OTP for ${email}: ${otp}`);

  return NextResponse.json({
    success: true,
    // Remove 'otp' from the response before launching publicly
    otp,
  });
}
