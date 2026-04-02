// POST /api/process
// Body: multipart/form-data { file: File, mode: string, language?: string }
// Uploads the PDF to Gemini Files API, runs a generateContent call,
// returns { result: { summary, actions, risks }, processingTime }

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getSessionToken } from "@/lib/auth/session";

export const runtime = "edge";

const FREE_LIMIT = 3;

// ── Language → instruction snippet ──────────────────────────────────────────
function langInstruction(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (!normalized || normalized === "english") return "";
  // Capitalise first letter for the prompt
  const display = language.trim().charAt(0).toUpperCase() + language.trim().slice(1);
  return ` Write the entire response in ${display}.`;
}

// ── Mode → system prompt ─────────────────────────────────────────────────────
function buildPrompt(mode: string, language: string): string {
  const lang = langInstruction(language);

  const base = `You are an expert document analyst. Analyse the uploaded PDF and respond with a JSON object with exactly three keys: "summary", "actions", "risks".${lang}

Rules:
- Every key must always be present (use empty string if not applicable).
- Do NOT wrap in markdown code fences — return raw JSON only.
- Keep formatting clean: use bullet points starting with • for lists inside the string values, separated by \\n.`;

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

  // ── Auth ─────────────────────────────────────────────────────────────────
  const token = getSessionToken(req);
  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const userId = await env.KV.get(`session:${token}`);
  if (!userId) {
    return NextResponse.json({ error: "Session expired" }, { status: 401 });
  }
  const user = await env.DB.prepare(
    `SELECT id, plan, docs_used FROM users WHERE id = ?`
  ).bind(userId).first<{ id: string; plan: string; docs_used: number }>();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  // ── Usage gate for free plan ─────────────────────────────────────────────
  if (user.plan !== "pro" && (user.docs_used ?? 0) >= FREE_LIMIT) {
    return NextResponse.json(
      { error: "Free limit reached. Upgrade to Pro for unlimited analyses." },
      { status: 403 }
    );
  }

  // ── Parse form data ───────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const file     = formData.get("file") as File | null;
  const mode     = ((formData.get("mode") as string) || "summary").toLowerCase();
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
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AI service not configured" }, { status: 500 });
  }

  const startTime = Date.now();

  // ── Step 1: Upload PDF to Gemini Files API ────────────────────────────────
  // We stream the file bytes directly to the resumable upload endpoint.
  let fileUri: string;
  let mimeType: string;
  try {
    const fileBytes = await file.arrayBuffer();
    const numBytes  = fileBytes.byteLength;
    mimeType        = "application/pdf";

    // Initiate upload
    const initRes = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=resumable&key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command":  "start",
          "X-Goog-Upload-Header-Content-Length": String(numBytes),
          "X-Goog-Upload-Header-Content-Type":   mimeType,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          file: { display_name: file.name },
        }),
      }
    );

    if (!initRes.ok) {
      const errText = await initRes.text().catch(() => "");
      console.error("Gemini upload init failed:", initRes.status, errText);
      return NextResponse.json(
        { error: "Failed to start AI upload — please try again" },
        { status: 502 }
      );
    }

    const uploadUrl = initRes.headers.get("x-goog-upload-url");
    if (!uploadUrl) {
      return NextResponse.json(
        { error: "Failed to get upload URL from AI service" },
        { status: 502 }
      );
    }

    // Upload bytes
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Length":         String(numBytes),
        "X-Goog-Upload-Offset":   "0",
        "X-Goog-Upload-Command":  "upload, finalize",
        "Content-Type":           mimeType,
      },
      body: fileBytes,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => "");
      console.error("Gemini upload failed:", uploadRes.status, errText);
      return NextResponse.json(
        { error: "Failed to upload PDF to AI service" },
        { status: 502 }
      );
    }

    const uploadData = await uploadRes.json() as {
      file?: { uri?: string; name?: string; state?: string };
    };
    fileUri = uploadData?.file?.uri ?? "";
    const fileName = uploadData?.file?.name ?? "";
    if (!fileUri) {
      return NextResponse.json({ error: "No file URI returned from AI service" }, { status: 502 });
    }

    // ── Poll until file state is ACTIVE (Gemini processes it asynchronously) ──
    if (uploadData?.file?.state === "PROCESSING" && fileName) {
      let attempts = 0;
      const maxAttempts = 15; // up to ~15s
      while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 1000));
        attempts++;
        try {
          const statusRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`
          );
          if (statusRes.ok) {
            const statusData = await statusRes.json() as { state?: string };
            if (statusData.state === "ACTIVE") break;
            if (statusData.state === "FAILED") {
              return NextResponse.json(
                { error: "AI service failed to process the PDF — please try again" },
                { status: 502 }
              );
            }
          }
        } catch { /* keep polling */ }
      }
    }
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "Error communicating with AI service" }, { status: 502 });
  }

  // ── Step 2: Generate content with Gemini ─────────────────────────────────
  let rawText: string;
  try {
    const prompt = buildPrompt(mode, language);
    const genRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { file_data: { mime_type: mimeType, file_uri: fileUri } },
                { text: prompt },
              ],
            },
          ],
          generationConfig: {
            temperature:     0.3,
            maxOutputTokens: 4096,

          },
        }),
      }
    );

    if (!genRes.ok) {
      const errBody = await genRes.text().catch(() => "");
      console.error("Gemini generateContent failed:", genRes.status, errBody);

      // Try to extract a human-readable message from Gemini's error body
      let geminiMsg = "";
      try {
        const errJson = JSON.parse(errBody);
        geminiMsg = errJson?.error?.message ?? "";
      } catch { /* ignore */ }

      if (genRes.status === 429) {
        return NextResponse.json(
          { error: "AI rate limit reached — please wait a moment and try again" },
          { status: 429 }
        );
      }
      if (genRes.status === 400) {
        return NextResponse.json(
          { error: geminiMsg || "AI rejected the request — the PDF may be encrypted or corrupted" },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: geminiMsg || "AI analysis failed — please try again" },
        { status: 502 }
      );
    }

    const genData = await genRes.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
    };

    rawText = genData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!rawText) {
      return NextResponse.json({ error: "AI returned an empty response" }, { status: 502 });
    }
  } catch (err) {
    console.error("Generation error:", err);
    return NextResponse.json({ error: "Error communicating with AI service" }, { status: 502 });
  }

  // ── Step 3: Parse AI response ─────────────────────────────────────────────
  let result: { summary: string; actions: string; risks: string };
  try {
    // Strip any accidental markdown fences in case Gemini adds them
    const cleaned = rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");
    const parsed = JSON.parse(cleaned);
    result = {
      summary: String(parsed.summary ?? ""),
      actions: String(parsed.actions ?? ""),
      risks:   String(parsed.risks   ?? ""),
    };
  } catch {
    // Fallback: put raw text in summary
    result = { summary: rawText, actions: "", risks: "" };
  }

  const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── Step 4: Persist document + summary to D1 ─────────────────────────────
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

    // Increment docs_used for free plan users
    if (user.plan !== "pro") {
      await env.DB.prepare(
        `UPDATE users SET docs_used = docs_used + 1 WHERE id = ?`
      ).bind(userId).run();
    }
  } catch (err) {
    // Non-fatal — we still return the result even if DB write fails
    console.error("DB write error:", err);
  }

  // ── Step 5: Delete uploaded file from Gemini (fire-and-forget) ───────────
  // Extract file name from URI  e.g. "https://...files/abc123" → "files/abc123"
  try {
    const fileId   = fileUri.split("/").slice(-2).join("/"); // "files/<id>"
    fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileId}?key=${apiKey}`,
      { method: "DELETE" }
    ).catch(() => {/* ignore */});
  } catch { /* ignore */ }

  return NextResponse.json({ result, processingTime });
}
