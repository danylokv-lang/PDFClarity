// POST /api/explain
// Body: { word: string, context?: string, language?: string }
// Returns { explanation: string }

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getSessionToken } from "@/lib/auth/session";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const { env } = getRequestContext();

  // Light auth check — must be logged in
  const token = getSessionToken(req);
  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const userId = await env.KV.get(`session:${token}`);
  if (!userId) {
    return NextResponse.json({ error: "Session expired" }, { status: 401 });
  }

  let body: { word?: string; context?: string; language?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const word = (body.word ?? "").trim();
  if (!word || word.length > 100) {
    return NextResponse.json({ error: "Invalid word" }, { status: 400 });
  }

  const language = (body.language ?? "English").trim();
  const context = (body.context ?? "").trim().slice(0, 300);

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AI service not configured" }, { status: 500 });
  }

  const langHint = language.toLowerCase() !== "english"
    ? ` Answer in ${language}.`
    : "";

  const prompt = `Explain the term "${word}" in simple, everyday language that anyone can understand. Give a complete explanation in 2–3 sentences. Do not cut off mid-sentence.${langHint}${context ? `\n\nContext from the document: "${context}"` : ""}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
        }),
      }
    );

    if (!res.ok) {
      return NextResponse.json({ error: "AI error" }, { status: 502 });
    }

    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const explanation = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    return NextResponse.json({ explanation: explanation || "No explanation available." });
  } catch {
    return NextResponse.json({ error: "Could not reach AI service" }, { status: 502 });
  }
}
