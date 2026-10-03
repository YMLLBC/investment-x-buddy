import type { AgentRun, Evidence, MemoryEntry, RunMode } from "./types.ts";

export interface BuddyResult { meta: { changes: number }; }
export interface BuddyStatement {
  bind(...values: (string | number | null)[]): BuddyStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<BuddyResult>;
}
export interface BuddyDatabase {
  prepare(sql: string): BuddyStatement;
  batch(statements: BuddyStatement[]): Promise<BuddyResult[]>;
}
export interface RunRecord {
  run: AgentRun; symbols: string[]; scenario: "normal" | "missing" | "failure";
  planning: boolean; reviewAttempts: number; retryAt: number; leaseId: string | null; leaseUntil: number;
}
export type RunSummary = Pick<AgentRun, "id" | "title" | "goal" | "mode" | "status" | "createdAt" | "updatedAt" | "metrics" | "version"> & { symbols: string[]; planning: boolean };
interface RunRow { id: string; owner_id: string; mode: RunMode; version: number; run_json: string; symbols: string; scenario: RunRecord["scenario"]; planning: number; review_attempts: number; retry_at: number; lease_id: string | null; lease_until: number; }
type Value = string | number | null;
const utf8 = new TextEncoder();
function modeCheck(mode: RunMode) { if (mode !== "demo" && mode !== "live") throw new Error("Invalid mode"); }
function bounded(values: unknown) { if (utf8.encode(JSON.stringify(values)).length > 900000) throw new Error("Database row exceeds 900000 UTF-8 bytes"); }
function finiteNonnegative(n: number) { if (!Number.isFinite(n) || n < 0) throw new Error("Expected finite nonnegative number"); }
function dayCheck(day: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) throw new Error("Invalid UTC budget day"); }
function canonicalMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalMetadata);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonicalMetadata(child)]));
  }
  return value;
}
function evidenceJson(evidence: Evidence): string {
  // Exclude raw before recursion: its complete property order is part of the source hash.
  const { raw, ...metadata } = evidence;
  return JSON.stringify({ ...canonicalMetadata(metadata) as Record<string, unknown>, raw });
}
function serialize(record: RunRecord) {
  const r = record.run; modeCheck(r.mode);
  if (!r.id || !r.ownerId || !Number.isSafeInteger(r.version) || r.version < 0 || r.evidence.length > 25 || new Set(r.evidence.map(e => e.id)).size !== r.evidence.length) throw new Error("Invalid run or evidence bounds");
  const evidence = r.evidence.map(e => {
    if (!e.id || typeof e.hash !== "string") throw new Error("Invalid evidence identity");
    const json = evidenceJson(e); bounded([r.id, e.id, json, e.hash]); return { id: e.id, hash: e.hash, json };
  });
  const json = JSON.stringify({ ...r, evidence: r.evidence.map(e => ({ ...e, raw: null })) });
  const values: Value[] = [r.id, r.ownerId, r.mode, r.version, r.updatedAt, json, JSON.stringify(record.symbols), record.scenario, Number(record.planning), record.reviewAttempts, record.retryAt, record.leaseId, record.leaseUntil];
  bounded(values); return { json, values, evidence };
}
export class BuddyRepository {
  private db: BuddyDatabase;
  constructor(db: BuddyDatabase) { this.db = db; }
  private query(sql: string, ...values: Value[]) { return this.db.prepare(sql).bind(...values); }
  private async hydrate(row: RunRow): Promise<RunRecord> {
    const run = JSON.parse(row.run_json) as AgentRun;
    const result = await this.query("SELECT e.evidence_json FROM buddy_evidence e JOIN buddy_runs r ON r.id=e.run_id WHERE r.id=? AND r.owner_id=? AND r.mode=?", row.id, row.owner_id, row.mode).all<{ evidence_json: string }>();
    const evidence = new Map(result.results.map(e => { const value = JSON.parse(e.evidence_json) as Evidence; return [value.id, value]; }));
    run.evidence = run.evidence.map(e => { const full = evidence.get(e.id); if (!full) throw new Error("Missing stored evidence"); return full; });
    return { run, symbols: JSON.parse(row.symbols), scenario: row.scenario, planning: Boolean(row.planning), reviewAttempts: row.review_attempts, retryAt: row.retry_at, leaseId: row.lease_id, leaseUntil: row.lease_until };
  }
  async insert(record: RunRecord): Promise<void> {
    const data = serialize(record);
    const statements = [this.query("INSERT INTO buddy_runs (id,owner_id,mode,version,updated_at,run_json,symbols,scenario,planning,review_attempts,retry_at,lease_id,lease_until) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", ...data.values)];
    for (const e of data.evidence) statements.push(this.query("INSERT INTO buddy_evidence (run_id,id,evidence_json,hash) VALUES (?,?,?,?)", record.run.id, e.id, e.json, e.hash));
    await this.db.batch(statements);
  }
  async get(id: string, ownerId: string, mode: RunMode): Promise<RunRecord | null> {
    const row = await this.query("SELECT * FROM buddy_runs WHERE id=? AND owner_id=? AND mode=?", id, ownerId, mode).first<RunRow>();
    return row ? this.hydrate(row) : null;
  }
  async list(ownerId: string, mode: RunMode): Promise<RunSummary[]> {
    const rows = await this.query("SELECT run_json,symbols,planning FROM buddy_runs WHERE owner_id=? AND mode=? ORDER BY updated_at DESC,id DESC LIMIT 30", ownerId, mode).all<Pick<RunRow, "run_json" | "symbols" | "planning">>();
    return rows.results.map(row => { const { id, title, goal, mode, status, createdAt, updatedAt, metrics, version } = JSON.parse(row.run_json) as AgentRun; return { id, title, goal, mode, status, createdAt, updatedAt, metrics, version, symbols: JSON.parse(row.symbols), planning: Boolean(row.planning) }; });
  }
  async save(record: RunRecord, expectedVersion: number, leaseId?: string): Promise<boolean> {
    if (!Number.isSafeInteger(expectedVersion) || record.run.version <= expectedVersion) throw new Error("Version must advance");
    const data = serialize(record); const r = record.run;
    const predicate = "id=? AND owner_id=? AND mode=? AND version=?" + (leaseId !== undefined ? " AND lease_id=?" : "");
    const condition: Value[] = [r.id, r.ownerId, r.mode, expectedVersion, ...(leaseId !== undefined ? [leaseId] : [])];
    // A collision with different contents deliberately violates NOT NULL and rolls back this whole batch.
    const statements = data.evidence.map(e => this.query(`INSERT INTO buddy_evidence (run_id,id,evidence_json,hash) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM buddy_runs WHERE ${predicate}) ON CONFLICT(run_id,id) DO UPDATE SET evidence_json=CASE WHEN buddy_evidence.evidence_json=excluded.evidence_json AND buddy_evidence.hash=excluded.hash THEN buddy_evidence.evidence_json ELSE NULL END`, r.id, e.id, e.json, e.hash, ...condition));
    statements.push(this.query(`UPDATE buddy_runs SET version=?,updated_at=?,run_json=?,symbols=?,scenario=?,planning=?,review_attempts=?,retry_at=?${leaseId === undefined ? ",lease_id=NULL,lease_until=0" : ""} WHERE ${predicate}`, r.version, r.updatedAt, data.json, JSON.stringify(record.symbols), record.scenario, Number(record.planning), record.reviewAttempts, record.retryAt, ...condition));
    const result = await this.db.batch(statements); return result[result.length - 1].meta.changes === 1;
  }
  async acquire(id: string, ownerId: string, mode: RunMode, now: number, leaseMs = 180000): Promise<{ record: RunRecord; leaseId: string } | null> {
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(leaseMs) || leaseMs <= 0 || leaseMs > 180000) throw new Error("Invalid lease duration");
    const leaseId = crypto.randomUUID();
    const row = await this.query("UPDATE buddy_runs SET lease_id=?,lease_until=? WHERE id=? AND owner_id=? AND mode=? AND (lease_id IS NULL OR lease_until<=?) RETURNING *", leaseId, now + leaseMs, id, ownerId, mode, now).first<RunRow>();
    return row ? { record: await this.hydrate(row), leaseId } : null;
  }
  async release(id: string, ownerId: string, mode: RunMode, leaseId: string): Promise<boolean> {
    return (await this.query("UPDATE buddy_runs SET lease_id=NULL,lease_until=0 WHERE id=? AND owner_id=? AND mode=? AND lease_id=?", id, ownerId, mode, leaseId).run()).meta.changes === 1;
  }
  async memories(ownerId: string, mode: RunMode): Promise<MemoryEntry[]> {
    return (await this.query("SELECT id,text,kind,created_at AS createdAt FROM buddy_memory WHERE owner_id=? AND mode=? ORDER BY created_at DESC,id DESC LIMIT 50", ownerId, mode).all<MemoryEntry>()).results;
  }
  async addMemory(ownerId: string, mode: RunMode, entry: MemoryEntry): Promise<void> {
    modeCheck(mode);
    if (!entry.id || typeof entry.text !== "string" || entry.text.length > 2000 || !["preference", "research"].includes(entry.kind)) throw new Error("Invalid memory");
    bounded([ownerId, mode, entry]);
    const result = await this.query("INSERT INTO buddy_memory (id,owner_id,mode,text,kind,created_at) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM buddy_memory WHERE owner_id=? AND mode=?)<50", entry.id, ownerId, mode, entry.text, entry.kind, entry.createdAt, ownerId, mode).run();
    if (result.meta.changes !== 1) throw new Error("Memory limit reached");
  }
  async deleteMemory(ownerId: string, mode: RunMode, id: string): Promise<boolean> {
    return (await this.query("DELETE FROM buddy_memory WHERE id=? AND owner_id=? AND mode=?", id, ownerId, mode).run()).meta.changes === 1;
  }
  async reserveBudget(day: string, amount: number, cap: number, token: string, ownerId: string, runId: string): Promise<boolean> {
    dayCheck(day); finiteNonnegative(amount); finiteNonnegative(cap);
    bounded([day, amount, cap, token, ownerId, runId]);
    const result = await this.query("INSERT INTO buddy_model_reservations (token,day,amount,actual,status,owner_id,run_id) SELECT ?,?,?,NULL,'pending',?,? WHERE COALESCE((SELECT SUM(CASE WHEN status='pending' THEN amount ELSE actual END) FROM buddy_model_reservations WHERE day=?),0)+?<=? ON CONFLICT(token) DO NOTHING", token, day, amount, ownerId, runId, day, amount, cap).run();
    return result.meta.changes === 1;
  }
  async settleBudget(token: string, actual: number | null): Promise<boolean> {
    if (actual !== null) finiteNonnegative(actual);
    return (await this.query("UPDATE buddy_model_reservations SET actual=COALESCE(?,amount),status='settled' WHERE token=? AND status='pending'", actual, token).run()).meta.changes === 1;
  }
  async budget(day: string): Promise<{ spent: number; reserved: number }> {
    dayCheck(day);
    return (await this.query("SELECT COALESCE(SUM(CASE WHEN status='settled' THEN actual ELSE 0 END),0) AS spent,COALESCE(SUM(CASE WHEN status='pending' THEN amount ELSE 0 END),0) AS reserved FROM buddy_model_reservations WHERE day=?", day).first<{ spent: number; reserved: number }>())!;
  }
  async rateLimit(key: string, windowMs: number, max: number, now: number): Promise<boolean> {
    if (!Number.isSafeInteger(windowMs) || windowMs <= 0 || !Number.isSafeInteger(max) || max < 1 || !Number.isSafeInteger(now)) throw new Error("Invalid rate limit");
    bounded(key); const start = Math.floor(now / windowMs) * windowMs;
    // Reject delayed requests from older windows instead of resetting the current count.
    const result = await this.query("INSERT INTO buddy_rate_limits (key,window_start,window_ms,count) VALUES (?,?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,window_ms=excluded.window_ms,count=CASE WHEN buddy_rate_limits.window_start=excluded.window_start AND buddy_rate_limits.window_ms=excluded.window_ms THEN buddy_rate_limits.count+1 ELSE 1 END WHERE buddy_rate_limits.window_start<excluded.window_start OR (buddy_rate_limits.window_start=excluded.window_start AND (buddy_rate_limits.window_ms<>excluded.window_ms OR buddy_rate_limits.count<?))", key, start, windowMs, max).run();
    return result.meta.changes === 1;
  }
}
