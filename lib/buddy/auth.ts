import type { RunMode, Session } from "./types.ts";

const TTL = 604800000;
const encoder = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid token");
  const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  if (base64url(bytes) !== value) throw new Error("Invalid token");
  return bytes;
}
async function key(secret: string) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("Invalid session secret");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
function validSession(value: unknown): value is Session {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const s = value as Session;
  return Object.keys(s).length === 3 && typeof s.ownerId === "string" && UUID.test(s.ownerId) && (s.mode === "demo" || s.mode === "live") && Number.isSafeInteger(s.expiresAt);
}
export function newSession(mode: RunMode, now: number): Session {
  if ((mode !== "demo" && mode !== "live") || !Number.isSafeInteger(now)) throw new Error("Invalid session input");
  return { ownerId: crypto.randomUUID(), mode, expiresAt: now + TTL };
}
export async function signSession(session: Session, secret: string): Promise<string> {
  if (!validSession(session)) throw new Error("Invalid session");
  const payload = base64url(encoder.encode(JSON.stringify(session)));
  if (payload.length > 1024) throw new Error("Session payload too large");
  const signature = await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(payload));
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}
export async function verifySession(token: string, secret: string, now: number): Promise<Session | null> {
  try {
    if (typeof token !== "string" || token.length > 1068 || !Number.isSafeInteger(now)) return null;
    const parts = token.split(".");
    if (parts.length !== 2 || parts[0].length > 1024 || parts[1].length !== 43) return null;
    if (!await crypto.subtle.verify("HMAC", await key(secret), decode(parts[1]), encoder.encode(parts[0]))) return null;
    const session: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decode(parts[0])));
    if (!validSession(session) || session.expiresAt <= now || session.expiresAt - now > TTL) return null;
    return session;
  } catch { return null; }
}
export function sessionCookie(token: string, url: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(token) || token.length > 1068) throw new Error("Invalid cookie token");
  return `buddy_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${new URL(url).protocol === "https:" ? "; Secure" : ""}`;
}
export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header || header.length > 16384) return null;
  let token: string | null = null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== "buddy_session") continue;
    const value = part.slice(separator + 1).trim();
    if (!value || value.length > 1068 || !/^[A-Za-z0-9_.-]+$/.test(value) || (token !== null && token !== value)) return null;
    token = value;
  }
  return token;
}
