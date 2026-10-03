import test from "node:test";
import assert from "node:assert/strict";
import { sqliteD1 } from "./support/d1.ts";
import { sha256 } from "../lib/buddy/data.ts";
import type { RunRecord } from "../lib/buddy/repository.ts";
const repositoryModule = await import("../lib/buddy/repository.ts").catch(() => null);
function record(id = crypto.randomUUID()): RunRecord {
  return { run: { id, ownerId: "owner-a", mode: "demo", goal: "research", title: "test", status: "awaiting_approval", approved: false, createdAt: "2026-10-02T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z", plan: [], evidence: [], events: [], contextSummary: "", metrics: { toolCalls: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0, elapsedMs: 0 }, limits: { maxToolCalls: 10, maxModelCalls: 10, maxEstimatedUsd: 1, maxRuntimeMs: 300000 }, version: 0, checkpoint: { cursor: 0, completedTaskIds: [], savedAt: "2026-10-02T00:00:00Z" }, memory: [] }, symbols: ["000001"], scenario: "normal", planning: true, reviewAttempts: 0, retryAt: 0, leaseId: null, leaseUntil: 0 };
}
function evidence(id = "e1") { return { id, title: "Revenue", provider: "fixture", sourceUrl: "https://example.test", retrievedAt: "2026-10-02T00:00:00Z", asOf: null, unit: "CNY", scope: "annual", quality: "valid" as const, summary: "record", raw: { rows: [1, 2, 3], 中文: "完整" }, hash: "sha256:abc", metrics: [{ key: "revenue", label: "Revenue", value: 12, unit: "CNY" }], series: [{ date: "2026-10-01", value: 12 }] }; }
function setup() { assert.ok(repositoryModule, "repository implementation must exist"); const database = sqliteD1(); return { ...database, repo: new repositoryModule.BuddyRepository(database.db) }; }
test("roundtrip preserves evidence and rejects cross-owner/mode and duplicate run IDs", async () => {
  const { repo, sqlite } = setup(); const r = record(); r.run.evidence = [evidence()];
  await repo.insert(r); assert.deepEqual(await repo.get(r.run.id, "owner-a", "demo"), r);
  assert.equal(await repo.get(r.run.id, "owner-b", "demo"), null); assert.equal(await repo.get(r.run.id, "owner-a", "live"), null);
  assert.deepEqual(await repo.list("owner-b", "demo"), []); assert.deepEqual(await repo.list("owner-a", "live"), []);
  assert.equal("evidence" in (await repo.list("owner-a", "demo"))[0], false);
  const other = structuredClone(r); other.run.ownerId = "owner-b"; await assert.rejects(repo.insert(other));
  const row = sqlite.prepare("SELECT run_json FROM buddy_runs").get()!; assert.equal(JSON.parse(String(row.run_json)).evidence[0].raw, null);
  sqlite.close();
});
test("CAS conflict adds no late evidence; immutable evidence collision rolls back the entire batch", async () => {
  const { repo, sqlite } = setup(); const r = record(); await repo.insert(r);
  const next = structuredClone(r); next.run.version = 1; next.run.evidence = [evidence()]; assert.equal(await repo.save(next, 0), true);
  const stale = structuredClone(r); stale.run.version = 2; stale.run.evidence = [evidence("late")]; assert.equal(await repo.save(stale, 0), false);
  const unauthorized = structuredClone(next); unauthorized.run.version = 2; unauthorized.run.ownerId = "owner-b";
  assert.equal(await repo.save(unauthorized, 1), false); unauthorized.run.ownerId = "owner-a"; unauthorized.run.mode = "live"; assert.equal(await repo.save(unauthorized, 1), false);
  next.run.version = 2; assert.equal(await repo.save(next, 1), true); next.run.version = 3;
  assert.equal(sqlite.prepare("SELECT count(*) n FROM buddy_evidence").get()!.n, 1);
  next.run.evidence.unshift(evidence("new")); next.run.evidence[1].raw = { rows: [9], 中文: "different" };
  await assert.rejects(repo.save(next, 2)); assert.equal(sqlite.prepare("SELECT count(*) n FROM buddy_evidence").get()!.n, 1);
  assert.equal((await repo.get(r.run.id, "owner-a", "demo"))!.run.version, 2);
  sqlite.close();
});
test("lease acquisition is exclusive, expiring lease preserves run, and user save invalidates old worker", async () => {
  const { repo, sqlite } = setup(); const r = record(); await repo.insert(r);
  await assert.rejects(repo.acquire(r.run.id, "owner-a", "demo", 1000, 180001));
  const winners = (await Promise.all(Array.from({ length: 8 }, () => repo.acquire(r.run.id, "owner-a", "demo", 1000, 90000)))).filter(Boolean);
  assert.equal(winners.length, 1); const held = winners[0]!;
  assert.deepEqual(held.record.run, r.run); assert.equal(held.record.leaseUntil, 91000);
  assert.equal(await repo.acquire(r.run.id, "owner-b", "demo", 1000), null);
  assert.equal(await repo.acquire(r.run.id, "owner-a", "live", 1000), null);
  const newer = await repo.acquire(r.run.id, "owner-a", "demo", 91000); assert.ok(newer); assert.deepEqual(newer.record.run, r.run);
  const worker = structuredClone(newer.record); worker.run.version = 1;
  assert.equal(await repo.save(worker, 0, held.leaseId), false);
  assert.equal(await repo.save(worker, 0, newer.leaseId), true);
  assert.equal((await repo.get(r.run.id, "owner-a", "demo"))!.leaseId, newer.leaseId);
  worker.run.version = 2; worker.run.status = "stopped"; assert.equal(await repo.save(worker, 1), true);
  worker.run.version = 3; worker.run.evidence = [evidence("late")]; assert.equal(await repo.save(worker, 2, newer.leaseId), false);
  assert.equal((await repo.get(r.run.id, "owner-a", "demo"))!.leaseId, null);
  assert.equal(await repo.release(r.run.id, "owner-a", "demo", newer.leaseId), false);
  const released = await repo.acquire(r.run.id, "owner-a", "demo", 999999); assert.ok(released);
  assert.equal(await repo.release(r.run.id, "owner-a", "demo", released.leaseId), true);
  assert.equal((await repo.get(r.run.id, "owner-a", "demo"))!.run.version, 2); sqlite.close();
});
test("global atomic budget reserves respect cap and settlement is once-only and conservative", async () => {
  const { repo, sqlite } = setup();
  const reserved = await Promise.all(Array.from({ length: 20 }, (_, i) => repo.reserveBudget("2026-10-02", 0.25, 1, `t${i}`, `owner${i}`, "run")));
  assert.equal(reserved.filter(Boolean).length, 4); assert.deepEqual(await repo.budget("2026-10-02"), { spent: 0, reserved: 1 });
  assert.equal(await repo.reserveBudget("2026-10-02", 0, 1, "t0", "x", "r"), false);
  assert.equal(await repo.settleBudget("t0", null), true); assert.equal(await repo.settleBudget("t0", 0), false);
  assert.equal(await repo.settleBudget("t1", 0.5), true); assert.deepEqual(await repo.budget("2026-10-02"), { spent: 0.75, reserved: 0.5 });
  assert.equal(await repo.reserveBudget("2026-10-02", 0.01, 1, "extra", "x", "r"), false);
  for (const day of ["2026-02-30", "2026-1-01", "bad"]) await assert.rejects(repo.reserveBudget(day, 0, 1, "x", "o", "r"));
  for (const amount of [-1, Infinity, NaN]) { await assert.rejects(repo.reserveBudget("2026-10-03", amount, 1, "x", "o", "r")); await assert.rejects(repo.settleBudget("t2", amount)); }
  await assert.rejects(repo.reserveBudget("2026-10-03", 0, Infinity, "x", "o", "r"));
  assert.equal(await repo.reserveBudget("2026-10-03", 0, 0, "zero", "o", "r"), true);
  assert.equal(await repo.settleBudget("missing", 0), false);
  sqlite.close();
});
test("memory cap, unique ids and isolation; atomic rate-limit window", async () => {
  const { repo, sqlite } = setup();
  const entry = { id: "m0", text: "preference", kind: "preference" as const, createdAt: "2026-10-02" };
  await repo.addMemory("owner-a", "demo", entry); await assert.rejects(repo.addMemory("owner-b", "live", entry));
  for (let i = 1; i < 50; i++) await repo.addMemory("owner-a", "demo", { ...entry, id: `m${i}` });
  await assert.rejects(repo.addMemory("owner-a", "demo", { ...entry, id: "overflow" }));
  assert.equal((await repo.memories("owner-a", "demo")).length, 50); assert.deepEqual(await repo.memories("owner-a", "live"), []);
  assert.equal(await repo.deleteMemory("owner-b", "demo", "m0"), false); assert.equal(await repo.deleteMemory("owner-a", "live", "m0"), false);
  assert.equal(await repo.deleteMemory("owner-a", "demo", "m0"), true);
  await assert.rejects(repo.addMemory("owner-a", "demo", { ...entry, text: "a".repeat(2001) }));
  assert.deepEqual(await Promise.all(Array.from({ length: 5 }, () => repo.rateLimit("k", 1000, 2, 999))), [true, true, false, false, false]);
  assert.equal(await repo.rateLimit("k", 1000, 2, 1000), true); assert.equal(await repo.rateLimit("other", 1000, 2, 999), true); sqlite.close();
});
test("row and evidence count bounds reject writes without partial data; list is bounded and sorted", async () => {
  const { repo, sqlite } = setup(); const r = record(); r.run.evidence = [{ ...evidence(), raw: "中".repeat(310000) }];
  await assert.rejects(repo.insert(r)); assert.equal(sqlite.prepare("SELECT count(*) n FROM buddy_runs").get()!.n, 0);
  r.run.evidence = []; r.run.contextSummary = "x".repeat(900001); await assert.rejects(repo.insert(r));
  r.run.contextSummary = ""; r.run.evidence = Array.from({ length: 26 }, (_, i) => evidence(`e${i}`)); await assert.rejects(repo.insert(r));
  r.run.evidence = []; await repo.insert(r); r.run.version = 1; r.run.evidence = [{ ...evidence(), raw: "中".repeat(310000) }];
  await assert.rejects(repo.save(r, 0)); assert.equal((await repo.get(r.run.id, "owner-a", "demo"))!.run.version, 0);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM buddy_evidence").get()!.n, 0);
  for (let i = 0; i < 32; i++) { const n = record(); n.run.updatedAt = new Date(1800000000000 + i).toISOString(); await repo.insert(n); }
  const list = await repo.list("owner-a", "demo"); assert.equal(list.length, 30); assert.ok(list[0].updatedAt > list[29].updatedAt); sqlite.close();
});
test("late requests cannot rewind the rate-limit window or replenish its count", async () => {
  const { repo, sqlite } = setup();
  const results = [];
  for (const now of [1000, 1000, 999, 1001]) results.push(await repo.rateLimit("out-of-order", 1000, 2, now));
  assert.deepEqual(results, [true, true, false, false]);
  const current = sqlite.prepare("SELECT window_start,count FROM buddy_rate_limits WHERE key=?").get("out-of-order")!;
  assert.equal(current.window_start, 1000); assert.equal(current.count, 2);
  assert.deepEqual(await Promise.all([2000, 1999, 2001, 1998, 2002].map(now => repo.rateLimit("out-of-order", 1000, 2, now))), [true, false, true, false, false]);
  const advanced = sqlite.prepare("SELECT window_start,count FROM buddy_rate_limits WHERE key=?").get("out-of-order")!;
  assert.equal(advanced.window_start, 2000); assert.equal(advanced.count, 2);
  sqlite.close();
});
test("evidence reload retains raw JSON property order and its original SHA-256", async () => {
  const { repo, sqlite } = setup(); const r = record();
  const raw = { z: 1, a: { z: 2, a: 3 }, rows: [{ z: 4, a: 5 }] };
  const hash = await sha256(raw);
  r.run.evidence = [{ ...evidence(), raw, hash }];
  await repo.insert(r);
  const inserted = (await repo.get(r.run.id, "owner-a", "demo"))!.run.evidence[0];
  assert.equal(await sha256(inserted.raw), hash);
  assert.equal(JSON.stringify(inserted.raw), JSON.stringify(raw));
  assert.equal(inserted.hash, hash);
  const saved = structuredClone(r); saved.run.version = 1;
  saved.run.evidence.push({ ...evidence("second"), raw, hash });
  assert.equal(await repo.save(saved, 0), true);
  const restored = (await repo.get(r.run.id, "owner-a", "demo"))!.run.evidence;
  for (const e of restored) { assert.equal(await sha256(e.raw), hash); assert.equal(e.hash, hash); }
  sqlite.close();
});
test("reordered evidence metadata remains idempotent without changing raw bytes or hash", async () => {
  const { repo, sqlite } = setup(); const r = record();
  const raw = { z: 1, a: { z: 2, a: 3 }, rows: [{ z: 4, a: 5 }] };
  const original = { ...evidence(), raw, hash: await sha256(raw) };
  r.run.evidence = [original]; await repo.insert(r);
  const storedBefore = sqlite.prepare("SELECT evidence_json FROM buddy_evidence WHERE run_id=? AND id=?").get(r.run.id, original.id)!.evidence_json;
  const reordered = Object.fromEntries(Object.entries(original).reverse()) as typeof original;
  reordered.metrics = original.metrics.map(metric => Object.fromEntries(Object.entries(metric).reverse()) as typeof metric);
  reordered.series = original.series.map(point => Object.fromEntries(Object.entries(point).reverse()) as typeof point);
  assert.deepEqual(reordered, original);
  assert.equal(JSON.stringify(reordered.raw), JSON.stringify(original.raw));
  r.run.evidence = [reordered]; r.run.version = 1;
  assert.equal(await repo.save(r, 0), true);
  const restored = (await repo.get(r.run.id, "owner-a", "demo"))!;
  assert.equal(restored.run.version, 1);
  assert.deepEqual(restored.run.evidence[0], original);
  assert.equal(JSON.stringify(restored.run.evidence[0].raw), JSON.stringify(raw));
  assert.equal(await sha256(restored.run.evidence[0].raw), original.hash);
  assert.equal(sqlite.prepare("SELECT evidence_json FROM buddy_evidence WHERE run_id=? AND id=?").get(r.run.id, original.id)!.evidence_json, storedBefore);
  r.run.version = 2; r.run.evidence[0].title = "different metadata";
  await assert.rejects(repo.save(r, 1));
  assert.equal((await repo.get(r.run.id, "owner-a", "demo"))!.run.version, 1);
  sqlite.close();
});
