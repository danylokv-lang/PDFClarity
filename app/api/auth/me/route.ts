// GET /api/auth/me
// Returns the current user from the session cookie, or 401 if not logged in.

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getSessionToken } from "@/lib/session";

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
    `SELECT id, email, plan, docs_used FROM users WHERE id = ?`
  ).bind(userId).first<{ id: string; email: string; plan: string; docs_used: number }>();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  return NextResponse.json({ user });
}
