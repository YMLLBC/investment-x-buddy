import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import type { BuddyDatabase, BuddyStatement, BuddyResult } from "../../lib/buddy/repository.ts";
export function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const dir = new URL("../../drizzle/", import.meta.url);
  for (const name of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(name, dir), "utf8"));
  class Statement implements BuddyStatement {
    sql: string; values: (string | number | null)[] = [];
    constructor(sql: string) { if (sql.trim().replace(/;$/, "").includes(";")) throw new Error("D1 prepare accepts one SQL statement"); this.sql = sql; }
    bind(...values: (string | number | null)[]) { const s = new Statement(this.sql); s.values = values; return s; }
    async first<T>() { const row = sqlite.prepare(this.sql).get(...this.values); return row ? { ...row } as T : null; }
    async all<T>() { return { results: sqlite.prepare(this.sql).all(...this.values).map(row => ({ ...row })) as T[] }; }
    execute(): BuddyResult { const r = sqlite.prepare(this.sql).run(...this.values); return { meta: { changes: Number(r.changes) } }; }
    async run(): Promise<BuddyResult> { return this.execute(); }
  }
  const db: BuddyDatabase = {
    prepare: sql => new Statement(sql),
    async batch(statements) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const s of statements) results.push((s as Statement).execute());
        sqlite.exec("COMMIT"); return results;
      } catch (e) { sqlite.exec("ROLLBACK"); throw e; }
    },
  };
  return { db, sqlite };
}
