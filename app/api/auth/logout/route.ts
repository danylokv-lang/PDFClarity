// POST /api/auth/logout
// Deletes the session from KV and clears the cookie.

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/session";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const { env } = getRequestContext();

  const token = getSessionToken(req);
  if (token) {
    await env.KV.delete(`session:${token}`);
  }

  const res = NextResponse.json({ success: true });
  res.headers.set("Set-Cookie", clearSessionCookie());
  return res;
}
