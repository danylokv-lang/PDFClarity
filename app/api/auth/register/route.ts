// POST /api/auth/register
// Body: { email: string, password: string }
// Creates a new user, sets session cookie.

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { generateToken, buildSessionCookie, hashPassword } from "@/lib/session";

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

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  // Check if account already exists
  const existing = await env.DB.prepare(
    `SELECT id FROM users WHERE email = ?`
  ).bind(email).first();

  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
  }

  // Hash password with PBKDF2
  const { hash, salt } = await hashPassword(password);

  // Create user
  const userId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, password_salt) VALUES (?, ?, ?, ?)`
  ).bind(userId, email, hash, salt).run();

  // Create session
  const token = generateToken();
  await env.KV.put(`session:${token}`, userId, { expirationTtl: SESSION_TTL });

  const res = NextResponse.json({
    success: true,
    user: { id: userId, email, plan: "free" },
  });
  res.headers.set("Set-Cookie", buildSessionCookie(token));
  return res;
}
