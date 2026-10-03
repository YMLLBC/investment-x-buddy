import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const buddyRuns = sqliteTable("buddy_runs", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), mode: text("mode").notNull(),
  version: integer("version").notNull(), updatedAt: text("updated_at").notNull(), runJson: text("run_json").notNull(),
  symbols: text("symbols").notNull(), scenario: text("scenario").notNull(), planning: integer("planning").notNull(),
  reviewAttempts: integer("review_attempts").notNull(), retryAt: integer("retry_at").notNull(),
  leaseId: text("lease_id"), leaseUntil: integer("lease_until").notNull().default(0),
}, table => [index("buddy_runs_owner_mode_updated").on(table.ownerId, table.mode, table.updatedAt)]);
export const buddyEvidence = sqliteTable("buddy_evidence", {
  runId: text("run_id").notNull().references(() => buddyRuns.id, { onDelete: "cascade" }),
  id: text("id").notNull(), evidenceJson: text("evidence_json").notNull(), hash: text("hash").notNull(),
}, table => [primaryKey({ columns: [table.runId, table.id] })]);
export const buddyMemory = sqliteTable("buddy_memory", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), mode: text("mode").notNull(),
  text: text("text").notNull(), kind: text("kind").notNull(), createdAt: text("created_at").notNull(),
}, table => [index("buddy_memory_owner_mode_created").on(table.ownerId, table.mode, table.createdAt)]);
export const buddyModelReservations = sqliteTable("buddy_model_reservations", {
  token: text("token").primaryKey(), day: text("day").notNull(), amount: real("amount").notNull(),
  actual: real("actual"), status: text("status").notNull(), ownerId: text("owner_id").notNull(), runId: text("run_id").notNull(),
}, table => [index("buddy_reservations_day").on(table.day)]);
export const buddyRateLimits = sqliteTable("buddy_rate_limits", {
  key: text("key").primaryKey(), windowStart: integer("window_start").notNull(), windowMs: integer("window_ms").notNull(), count: integer("count").notNull(),
});
