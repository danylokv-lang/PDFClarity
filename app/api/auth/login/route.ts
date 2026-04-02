// POST /api/auth/login
// Body: { email: string, password: string }
// Verifies credentials, sets session cookie.

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { generateToken, buildSessionCookie, verifyPassword } from "@/lib/auth/session";

export const runtime = "edge";

const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

export async function POST(req: NextRequest) {
  const { env } = getRequestContext();

  let email: string, password: string;
  try {
    const body = await req.json();
    email    = (body.email    ?? "").toString().toLowerCase().trim();
    password = (body.password ?? "").toString();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  // Fetch user with password fields
  const user = await env.DB.prepare(
    `SELECT id, email, plan, docs_used, password_hash, password_salt
     FROM users WHERE email = ?`
  ).bind(email).first<{
    id: string; email: string; plan: string; docs_used: number;
    password_hash: string | null; password_salt: string | null;
  }>();

  // Generic error — don't reveal whether the email exists
  if (!user || !user.password_hash || !user.password_salt) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const valid = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!valid) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  // Create session
  const token = generateToken();
  await env.KV.put(`session:${token}`, user.id, { expirationTtl: SESSION_TTL });

  const res = NextResponse.json({
    success: true,
    user: { id: user.id, email: user.email, plan: user.plan, docs_used: 0 },
  });
  res.headers.set("Set-Cookie", buildSessionCookie(token));
  return res;
}
