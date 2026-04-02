// POST /api/process
// Body: multipart/form-data { file: File, mode: string, language?: string }
// Sends the PDF inline (base64) to Gemini generateContent — no Files API needed.
// Returns { result: { summary, actions, risks }, processingTime }

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getSessionToken } from "@/lib/auth/session";

export const runtime = "edge";

const FREE_LIMIT = 3;

// ── Convert ArrayBuffer to base64 safely in edge runtime ────────────────────
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

// ── Language → instruction snippet ──────────────────────────────────────────
function langInstruction(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (!normalized || normalized === "english") return "";
  const display = language.trim().charAt(0).toUpperCase() + language.trim().slice(1);
  return ` Write the entire response in ${display}.`;
}

// ── Mode → system prompt ─────────────────────────────────────────────────────
function buildPrompt(mode: string, language: string): string {
  const lang = langInstruction(language);

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const base = `You are an expert document analyst. Today's date is ${today}. Analyse the uploaded PDF and respond with a JSON object with exactly three keys: "summary", "actions", "risks".${lang}

Rules:
- Every key must always be present (use empty string if not applicable).
- Do NOT wrap in markdown code fences — return raw JSON only.
- Use bullet points starting with • for lists inside the string values, separated by \\n.
- If the PDF contains images, charts, diagrams, tables, or visual elements, analyse them too and include relevant findings in your response.
- Wrap technical terms, abbreviations, jargon, or domain-specific words with double curly braces like {{term}} so they can be highlighted for explanation. Only mark words that a non-specialist might not understand. Do NOT mark common English words.
- When evaluating dates and timelines, use today's date as reference. Do NOT flag future events or ongoing activities as risks or inconsistencies if they are plausible given today's date.`;

  const hints: Record<string, string> = {
    summary: `
Focus especially on the "summary" key:
- Provide a comprehensive yet concise overview (3–6 paragraphs).
- Cover the main topic, key arguments, conclusions, and any important data/numbers.
- Keep actions and risks brief (2–4 bullets each) since this is a Summary-mode request.`,

    actions: `
Focus especially on the "actions" key:
- Extract every concrete action item, task, recommendation, or next step from the document.
- Format each as: "• [Owner if mentioned] Action — context/reason"
- Aim for completeness — list all actionable items you find.
- Keep summary and risks brief (2–3 sentences each) since this is an Actions-mode request.`,

    risks: `
Focus especially on the "risks" key:
- Identify every risk, concern, warning, caveat, or potential problem in the document.
- Format each as: "• [Severity: High/Medium/Low] Risk description — implication"
- Cover financial, legal, operational, and strategic risks where relevant.
- Keep summary and actions brief (2–3 sentences each) since this is a Risks-mode request.`,
  };

  return base + (hints[mode] ?? hints.summary);
}

export async function POST(req: NextRequest) {
  const { env } = getRequestContext();

  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = getSessionToken(req);
  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const userId = await env.KV.get(`session:${token}`);
  if (!userId) {
    return NextResponse.json({ error: "Session expired" }, { status: 401 });
  }
  const user = await env.DB.prepare(
    `SELECT id, plan FROM users WHERE id = ?`
  ).bind(userId).first<{ id: string; plan: string }>();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  // ── Usage gate (3 per week) ───────────────────────────────────────────────
  if (user.plan !== "pro") {
    const weekAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
    const usage = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM documents WHERE user_id = ? AND created_at > ?`
    ).bind(userId, weekAgo).first<{ cnt: number }>();
    if ((usage?.cnt ?? 0) >= FREE_LIMIT) {
      return NextResponse.json(
        { error: "Weekly limit reached. Upgrade to Pro for unlimited analyses." },
        { status: 403 }
      );
    }
  }

  // ── Parse form data ───────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const file     = formData.get("file") as File | null;
  const mode     = ((formData.get("mode")     as string) || "summary").toLowerCase();
  const language = ((formData.get("language") as string) || "English").trim();

  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No PDF file uploaded" }, { status: 400 });
  }
  if (!["summary", "actions", "risks"].includes(mode)) {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "File must be under 20 MB" }, { status: 400 });
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AI service not configured" }, { status: 500 });
  }

  const startTime = Date.now();

  // ── Encode PDF as base64 for inline request (no Files API needed) ─────────
  let base64Data: string;
  try {
    const buffer = await file.arrayBuffer();
    base64Data = bufferToBase64(buffer);
  } catch (err) {
    console.error("Base64 error:", err);
    return NextResponse.json({ error: "Failed to read the uploaded file" }, { status: 500 });
  }

  // ── Call Gemini generateContent with inline PDF data ──────────────────────
  let rawText: string;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: "application/pdf", data: base64Data } },
              { text: buildPrompt(mode, language) },
            ],
          }],
          generationConfig: {
            temperature:     0.3,
            maxOutputTokens: 4096,
          },
        }),
      }
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      let geminiMsg = "";
      try { geminiMsg = (JSON.parse(errBody)?.error?.message ?? ""); } catch { /* ignore */ }
      console.error("Gemini error:", res.status, errBody);

      if (res.status === 429) {
        return NextResponse.json(
          { error: "Rate limit reached — please wait a moment and try again" },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { error: geminiMsg || `AI analysis failed (${res.status}) — please try again` },
        { status: 502 }
      );
    }

    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!rawText) {
      return NextResponse.json({ error: "AI returned an empty response" }, { status: 502 });
    }
  } catch (err) {
    console.error("Gemini fetch error:", err);
    return NextResponse.json({ error: "Could not reach AI service — please try again" }, { status: 502 });
  }

  // ── Parse JSON result ─────────────────────────────────────────────────────
  let result: { summary: string; actions: string; risks: string; language: string };
  try {
    const cleaned = rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");
    const parsed = JSON.parse(cleaned);
    result = {
      summary: String(parsed.summary ?? ""),
      actions: String(parsed.actions ?? ""),
      risks:   String(parsed.risks   ?? ""),
      language,
    };
  } catch {
    result = { summary: rawText, actions: "", risks: "", language };
  }

  const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── Persist to D1 ─────────────────────────────────────────────────────────
  try {
    const docId     = crypto.randomUUID();
    const summaryId = crypto.randomUUID();

    await env.DB.prepare(
      `INSERT INTO documents (id, user_id, filename, file_size, created_at)
       VALUES (?, ?, ?, ?, unixepoch())`
    ).bind(docId, userId, file.name, file.size).run();

    await env.DB.prepare(
      `INSERT INTO summaries (id, document_id, mode, result, created_at)
       VALUES (?, ?, ?, ?, unixepoch())`
    ).bind(summaryId, docId, mode, JSON.stringify(result)).run();


  } catch (err) {
    console.error("DB write error:", err);
  }

  return NextResponse.json({ result, processingTime });
}
