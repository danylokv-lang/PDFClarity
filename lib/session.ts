import { NextRequest } from "next/server";

const SESSION_COOKIE = "pdfclarify_session";
const SESSION_TTL    = 60 * 60 * 24 * 30; // 30 days in seconds

// ── Generate a cryptographically random token ────────
export function generateToken(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Generate a 6-digit OTP ───────────────────────────
export function generateOTP(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1_000_000).padStart(6, "0");
}

// ── Read session token from cookie ───────────────────
export function getSessionToken(req: NextRequest): string | null {
  return req.cookies.get(SESSION_COOKIE)?.value ?? null;
}

// ── Build Set-Cookie header value ────────────────────
export function buildSessionCookie(token: string): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Strict`,
    `Path=/`,
    `Max-Age=${SESSION_TTL}`,
  ].join("; ");
}

// ── Clear session cookie ──────────────────────────────
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

// ── Password hashing with PBKDF2 (Web Crypto — edge safe) ────────────────────
const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export async function hashPassword(
  password: string
): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key  = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    key,
    256
  );
  return { hash: toHex(bits), salt: toHex(salt.buffer) };
}

export async function verifyPassword(
  password: string,
  storedHash: string,
  storedSalt: string
): Promise<boolean> {
  const salt = new Uint8Array(
    (storedSalt.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16))
  );
  const key  = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    key,
    256
  );
  const hash = toHex(bits);
  // Constant-time compare to prevent timing attacks
  if (hash.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++)
    diff |= hash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  return diff === 0;
}
