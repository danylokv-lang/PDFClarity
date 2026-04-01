// POST /api/auth/verify
// Body: { email: string, code: string }
// Verifies OTP, creates user in D1 if new, sets session cookie.

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { generateToken, buildSessionCookie } from "@/lib/auth/session";

export const runtime = "edge";

const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

export async function POST(req: NextRequest) {
  const { env } = getRequestContext();

  let email: string, code: string;
  try {
    const body = await req.json();
    email = (body.email ?? "").toString().toLowerCase().trim();
    code  = (body.code  ?? "").toString().trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!email || !code) {
    return NextResponse.json({ error: "Email and code required" }, { status: 400 });
  }

  // Check OTP in KV
  const stored = await env.KV.get(`otp:${email}`);
  if (!stored || stored !== code) {
    return NextResponse.json({ error: "Invalid or expired code" }, { status: 401 });
  }

  // Delete OTP — single use
  await env.KV.delete(`otp:${email}`);

  // Upsert user in D1
  const userId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email) VALUES (?, ?)
     ON CONFLICT(email) DO NOTHING`
  ).bind(userId, email).run();

  // Fetch the actual user (may already exist)
  const user = await env.DB.prepare(
    `SELECT id, email, plan FROM users WHERE email = ?`
  ).bind(email).first<{ id: string; email: string; plan: string }>();

  if (!user) {
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }

  // Create session in KV: key = session:<token>, value = user id
  const token = generateToken();
  await env.KV.put(`session:${token}`, user.id, { expirationTtl: SESSION_TTL });

  const res = NextResponse.json({ success: true, user });
  res.headers.set("Set-Cookie", buildSessionCookie(token));
  return res;
}
