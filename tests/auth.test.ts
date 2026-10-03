import test from "node:test";
import assert from "node:assert/strict";
const auth = await import("../lib/buddy/auth.ts").catch(() => null);
const secret = "secure-session-secret-at-least-32-characters";
const now = 1_800_000_000_000;
test("session authentication rejects forgery, expiry and invalid payloads", async () => {
  assert.ok(auth, "session implementation must exist");
  const session = auth.newSession("demo", now);
  assert.equal(session.expiresAt, now + 604800000);
  assert.notEqual(session.ownerId, auth.newSession("demo", now).ownerId);
  const token = await auth.signSession(session, secret);
  assert.deepEqual(await auth.verifySession(token, secret, now), session);
  assert.equal(await auth.verifySession(token, secret, session.expiresAt), null);
  assert.equal(await auth.verifySession(token, "x".repeat(32), now), null);
  const [payload, signature] = token.split(".");
  const tampered = Buffer.from(JSON.stringify({ ...session, mode: "live" })).toString("base64url");
  assert.equal(await auth.verifySession(`${tampered}.${signature}`, secret, now), null);
  assert.equal(await auth.verifySession(`${payload}.${"A".repeat(43)}`, secret, now), null);
  for (const value of ["", ".", "a".repeat(2000), "a.b.c"]) assert.equal(await auth.verifySession(value, secret, now), null);
  for (const bad of [{ ...session, ownerId: "oops" }, { ...session, mode: "admin" }, { ...session, expiresAt: now + 604800001 }]) {
    const data = Buffer.from(JSON.stringify(bad)).toString("base64url");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))).toString("base64url");
    assert.equal(await auth.verifySession(`${data}.${sig}`, secret, now), null);
  }
  await assert.rejects(auth.signSession(session, "short"));
});
test("access codes preserve whitespace and cookies respect local HTTP and duplicate boundaries", async () => {
  assert.ok(auth);
  assert.equal(await auth.checkAccessCode("abc", "abc"), true);
  for (const [a,b] of [["", ""], ["abc ", "abc"], ["abc", "abd"], ["x".repeat(129), "x".repeat(129)]]) assert.equal(await auth.checkAccessCode(a,b), false);
  const cookie = auth.sessionCookie("abc.def", "https://example.test");
  for (const flag of ["buddy_session=abc.def", "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=604800", "Secure"]) assert.ok(cookie.includes(flag));
  assert.ok(!auth.sessionCookie("abc.def", "http://localhost").includes("Secure"));
  const read = (cookie: string) => auth.readSessionCookie(new Request("http://localhost", { headers: { cookie } }));
  assert.equal(read("other=x; buddy_session=abc.def"), "abc.def");
  assert.equal(read("buddy_session=a; buddy_session=b"), null);
  assert.equal(read(`buddy_session=${"x".repeat(2000)}`), null);
  assert.equal(read("other=x"), null);
});
