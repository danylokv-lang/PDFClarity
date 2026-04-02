// GET /api/auth/me
// Returns the current user from the session cookie, or 401 if not logged in.

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getSessionToken } from "@/lib/auth/session";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { env } = getRequestContext();

  const token = getSessionToken(req);
  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Look up session in KV
  const userId = await env.KV.get(`session:${token}`);
  if (!userId) {
    return NextResponse.json({ error: "Session expired" }, { status: 401 });
  }

  // Fetch user from D1
  const user = await env.DB.prepare(
    `SELECT id, email, plan FROM users WHERE id = ?`
  ).bind(userId).first<{ id: string; email: string; plan: string }>();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  // Count docs used this week
  const weekAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  const usage = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM documents WHERE user_id = ? AND created_at > ?`
  ).bind(userId, weekAgo).first<{ cnt: number }>();

  return NextResponse.json({ user: { ...user, docs_used: usage?.cnt ?? 0 } });
}
