// GET /api/dashboard
// Returns the current user's recent documents, statistics, and activity.

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

  const userId = await env.KV.get(`session:${token}`);
  if (!userId) {
    return NextResponse.json({ error: "Session expired" }, { status: 401 });
  }

  const user = await env.DB.prepare(
    `SELECT id, email, plan, created_at FROM users WHERE id = ?`
  ).bind(userId).first<{
    id: string; email: string; plan: string; created_at: number;
  }>();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  // Recent documents joined with their latest summary mode + result
  const recentResult = await env.DB.prepare(`
    SELECT d.id, d.filename, d.file_size, d.page_count, d.created_at,
           s.mode, s.id AS summary_id, s.result
    FROM documents d
    LEFT JOIN summaries s ON s.id = (
      SELECT id FROM summaries WHERE document_id = d.id ORDER BY created_at DESC LIMIT 1
    )
    WHERE d.user_id = ?
    ORDER BY d.created_at DESC
    LIMIT 10
  `).bind(userId).all();

  // Aggregate stats
  const stats = await env.DB.prepare(`
    SELECT
      COUNT(*)                                                             AS total_docs,
      COALESCE(SUM(file_size),  0)                                        AS total_bytes,
      COALESCE(SUM(page_count), 0)                                        AS total_pages,
      COUNT(CASE WHEN created_at > unixepoch() - 7  * 86400 THEN 1 END)  AS this_week,
      COUNT(CASE WHEN created_at > unixepoch() - 30 * 86400 THEN 1 END)  AS this_month
    FROM documents
    WHERE user_id = ?
  `).bind(userId).first();

  // Mode breakdown
  const modesResult = await env.DB.prepare(`
    SELECT s.mode, COUNT(*) AS cnt
    FROM summaries s
    JOIN documents d ON d.id = s.document_id
    WHERE d.user_id = ?
    GROUP BY s.mode
    ORDER BY cnt DESC
  `).bind(userId).all();

  // Daily activity for the last 7 days
  const activityResult = await env.DB.prepare(`
    SELECT date(created_at, 'unixepoch') AS day, COUNT(*) AS cnt
    FROM documents
    WHERE user_id = ? AND created_at > unixepoch() - 7 * 86400
    GROUP BY day
    ORDER BY day ASC
  `).bind(userId).all();

  return NextResponse.json({
    user,
    recent:   recentResult.results,
    stats,
    modes:    modesResult.results,
    activity: activityResult.results,
  });
}
