import type { AgentRun, AgentTask, Evidence, ModelUsage, RunMode } from "./types.ts";
import { BuddyRepository, type RunRecord } from "./repository.ts";
import { addEvent, beginTask, compactContext, completeRun, failTask, resumeRun, succeedTask, validatePlan } from "./harness.ts";
import { compareFinancials } from "./data.ts";
import { executeDemo } from "./demo.ts";
import { curatedTools, executeTool, ProviderError } from "./providers.ts";
import { callModel, modelReservation, parsePlanResponse, parseReviewResponse, planningPayload, reviewPayload, type ModelConfig } from "./model.ts";
import { buildResearchReport } from "./research.ts";

export class ServiceError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
/** Read-only overrides for integration tests; production always uses the real providers. */
export interface EngineDependencies {
  readonly now?: () => number;
  readonly execute?: (task: AgentTask, mode: RunMode, scenario: RunRecord["scenario"], now: string, config: ModelConfig) => Promise<Evidence>;
  readonly model?: typeof callModel;
}
export function clock(dependencies: EngineDependencies): number { return Math.floor(dependencies.now?.() ?? Date.now()); }
export function tightened(value: string | undefined, cap: number): number {
  if (value === undefined || value === "") return cap;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new ServiceError(503, "CONFIGURATION", "服务预算配置无效，请联系管理员。");
  return Math.min(number, cap);
}
export function dailyCap(config: ModelConfig): number { return tightened(config.DAILY_MODEL_BUDGET_USD, 5); }
function nowText(dependencies: EngineDependencies): string { return new Date(clock(dependencies)).toISOString(); }
function parentResearch(run: AgentRun): unknown {
  if (!run.parentId || !run.contextSummary) return undefined;
  try {
    const saved = JSON.parse(run.contextSummary) as { parentResearch?: unknown; parentId?: string; summary?: string; status?: string };
    return saved.parentResearch ?? (saved.parentId === run.parentId ? { parentId: saved.parentId, summary: saved.summary, status: saved.status } : undefined);
  } catch { return undefined; }
}
function contextWithParent(run: AgentRun): ReturnType<typeof compactContext> {
  const parent = parentResearch(run), result = compactContext(run);
  if (parent !== undefined) {
    result.context = JSON.stringify({ parentResearch: parent, currentResearch: result.context });
    if (result.compressed) result.run.contextSummary = result.context;
  }
  return result;
}
function elapsed(run: AgentRun, now: string): AgentRun {
  const next = structuredClone(run);
  if (next.metrics.startedAt) next.metrics.elapsedMs = Math.max(next.metrics.elapsedMs, Date.parse(now) - Date.parse(next.metrics.startedAt));
  return next;
}
export function resumeAtCheckpoint(record: RunRecord, now: string): AgentRun {
  const run = record.run;
  if (run.mode !== "live" || record.planning || !run.plan.every(task => task.status === "completed")) return resumeRun(run, now);
  if (!run.approved || !["paused", "failed"].includes(run.status)) throw new ServiceError(409, "INVALID_STATE", "只有已批准且暂停的研究可以恢复复核。");
  if ((run.status === "failed" && run.stopReason !== "transient_failure") || ["permanent_failure", "retry_limit"].includes(run.stopReason ?? "")) throw new ServiceError(409, "NOT_RETRYABLE", "永久失败或重试次数已用尽，不能恢复。");
  const next = elapsed(run, now);
  const reason = next.metrics.elapsedMs >= next.limits.maxRuntimeMs ? "runtime_limit" : next.metrics.modelCalls >= next.limits.maxModelCalls ? "model_limit" : next.metrics.estimatedUsd >= next.limits.maxEstimatedUsd ? "cost_limit" : undefined;
  if (reason) throw new ServiceError(409, "BUDGET_EXHAUSTED", "复核预算已用尽，恢复不能重置预算。");
  // All tool tasks are complete: review needs model/cost/runtime headroom, not another tool.
  next.status = "running"; delete next.stopReason;
  return addEvent(next, "resumed", "研究从已保存证据恢复模型复核，调用计数与预算保留。", now);
}
export function userPause(record: RunRecord, now: string): RunRecord {
  if (record.run.status !== "running" && !(record.planning && record.leaseId && record.leaseUntil > Date.parse(now))) throw new ServiceError(409, "INVALID_STATE", "当前研究不能暂停。");
  const next = structuredClone(record); next.run = elapsed(next.run, now);
  for (const task of next.run.plan) if (task.status === "running") { task.status = "failed"; task.error = "执行已由用户暂停，恢复后可重新核验。"; }
  next.run.status = "paused"; next.run.stopReason = "user_paused";
  if (next.planning) next.planning = false;
  next.run = addEvent(next.run, "user_paused", "用户暂停研究，已保留检查点。", now);
  return next;
}
async function current(repo: BuddyRepository, record: RunRecord): Promise<RunRecord> {
  const result = await repo.get(record.run.id, record.run.ownerId, record.run.mode);
  if (!result) throw new ServiceError(404, "NOT_FOUND", "研究不存在。");
  return result;
}
function modelPending(record: RunRecord): boolean {
  const states = record.planning ? ["planning_started", "planning_completed", "planning_failed", "replan_requested"] : ["review_started", "review_failed", "completed"];
  const latest = [...record.run.events].reverse().find(e => [...states, "user_paused", "stopped", "lease_expired", "budget_paused"].includes(e.type));
  return latest?.type === (record.planning ? "planning_started" : "review_started");
}
/** Expiry never restarts an external operation. It requires an explicit user decision. */
async function recoverExpired(repo: BuddyRepository, record: RunRecord, dependencies: EngineDependencies): Promise<RunRecord | null> {
  const now = clock(dependencies);
  const pending = modelPending(record) || record.run.plan.some(t => t.status === "running");
  if ((record.leaseId && record.leaseUntil > now) || (!record.leaseId && !pending) || (!record.planning && !pending)) return null;
  const next = structuredClone(record), at = new Date(now).toISOString();
  if (next.planning) { next.planning = false; next.run.status = "failed"; next.run.approved = false; next.run.stopReason = "planning_failure"; next.run = addEvent(elapsed(next.run, at), "lease_expired", "规划请求失联，请明确重新规划；原调用计数和预算保留。", at); }
  else {
    const task = next.run.plan.find(t => t.status === "running");
    if (task) next.run = failTask(next.run, task.id, "上次工具请求未完成，请恢复后重新核验。", at, true);
    else { next.run = elapsed(next.run, at); next.run.status = "paused"; next.run = addEvent(next.run, "lease_expired", "上次模型复核未完成，请明确恢复。", at); }
    if (next.run.status === "paused") next.run.stopReason = "lease_expired";
  }
  if (!await repo.save(next, record.run.version)) return current(repo, record);
  return current(repo, next);
}
function failedModel(record: RunRecord, planning: boolean, now: string, code: string): RunRecord {
  const next = structuredClone(record); next.planning = false;
  next.run.status = planning ? "failed" : "paused";
  next.run.stopReason = planning ? "planning_failure" : "model_failure";
  next.run = addEvent(next.run, planning ? "planning_failed" : "review_failed", planning ? "规划未通过校验，请明确重新规划。" : "模型复核未完成或引用无效，请恢复后核验。", now, { code });
  return next;
}
function usageRecord(record: RunRecord, usage: ModelUsage | null, reserved: number, at: string): RunRecord {
  const next = structuredClone(record); next.run = elapsed(next.run, at);
  if (usage) {
    next.run.metrics.estimatedUsd = Math.max(0, next.run.metrics.estimatedUsd - reserved + usage.estimatedUsd);
    next.run.metrics.inputTokens += usage.inputTokens; next.run.metrics.outputTokens += usage.outputTokens;
  }
  next.run = addEvent(next.run, "model_usage", usage ? "模型调用用量已结算。" : "模型用量未知，保留保守费用计入预算。", at, { billing: usage ? "actual" : "unknown", ...(usage ?? {}) });
  return next;
}
async function modelStep(repo: BuddyRepository, record: RunRecord, leaseId: string, config: ModelConfig, dependencies: EngineDependencies): Promise<RunRecord> {
  const planning = record.planning, at = nowText(dependencies), base = elapsed(record.run, at);
  const payload = planning ? planningPayload(base.goal, record.symbols, curatedTools(), base.memory, at, config) : reviewPayload(base.goal, base.evidence, compareFinancials(base.evidence, record.symbols), contextWithParent(base).context, config);
  if (planning && parentResearch(base) !== undefined) payload.input = JSON.stringify({ ...JSON.parse(String(payload.input)), parentResearch: parentResearch(base) });
  const reservation = modelReservation(payload, Number(payload.max_output_tokens), config);
  const reason = base.metrics.elapsedMs >= base.limits.maxRuntimeMs ? "runtime_limit" : base.metrics.modelCalls >= base.limits.maxModelCalls ? "model_limit" : base.metrics.estimatedUsd + reservation > base.limits.maxEstimatedUsd ? "cost_limit" : undefined;
  if (reason) {
    const blocked = structuredClone(record); blocked.planning = false; blocked.run = base;
    blocked.run.status = planning ? "failed" : "paused"; blocked.run.stopReason = reason;
    blocked.run = addEvent(blocked.run, "budget_paused", "调用前预算检查未通过，未发出模型请求。", at);
    if (!await repo.save(blocked, record.run.version, leaseId)) return current(repo, record);
    return blocked;
  }
  const token = crypto.randomUUID(), day = at.slice(0, 10);
  if (!await repo.reserveBudget(day, reservation, dailyCap(config), token, base.ownerId, base.id)) {
    const blocked = failedModel(record, planning, at, "DAILY_BUDGET"); blocked.run.stopReason = "cost_limit";
    if (!await repo.save(blocked, record.run.version, leaseId)) return current(repo, record);
    return blocked;
  }
  const begun = structuredClone(record); begun.run = base;
  begun.run.metrics.startedAt ??= at; begun.run.metrics.modelCalls++; begun.run.metrics.estimatedUsd += reservation;
  if (!planning) begun.reviewAttempts++;
  begun.run = addEvent(begun.run, planning ? "planning_started" : "review_started", planning ? "规划模型调用已预留费用，等待返回。" : "复核模型调用已预留费用，等待返回。", at, { reservedUsd: reservation });
  if (!await repo.save(begun, record.run.version, leaseId)) { await repo.settleBudget(token, 0); return current(repo, record); }
  let result: Awaited<ReturnType<typeof callModel>> | undefined;
  let failure: unknown;
  try { result = await (dependencies.model ?? callModel)(payload, config); } catch (error) { failure = error; }
  // Every sent request remains billable, including a stopped or superseded run.
  await repo.settleBudget(token, result?.usage.estimatedUsd ?? null);
  let latest = await current(repo, begun);
  const end = nowText(dependencies);
  if (latest.run.version === begun.run.version && latest.leaseId === leaseId && latest.leaseUntil <= clock(dependencies)) latest = await recoverExpired(repo, latest, dependencies) ?? latest;
  if (latest.run.version !== begun.run.version || latest.leaseId !== leaseId || latest.leaseUntil <= clock(dependencies)) {
    // A concurrent late usage patch can advance the version while preserving this lease.
    // Do not silently repeat this invalidated operation after releasing the lease.
    const checkpoint = latest.leaseId === leaseId && latest.run.version !== begun.run.version ? failedModel(latest, planning, end, "CHECKPOINT_CHANGED") : latest;
    const billed = usageRecord(checkpoint, result?.usage ?? null, reservation, end);
    // One bounded CAS attempt; daily ledger is already settled even if the user mutates again.
    await repo.save(billed, latest.run.version, latest.leaseId ?? undefined);
    return current(repo, begun);
  }
  let next = usageRecord(begun, result?.usage ?? null, reservation, end);
  if (!result) next = failedModel(next, planning, end, failure instanceof ProviderError ? failure.code : "INTERNAL_MODEL");
  else if (next.run.metrics.estimatedUsd > next.run.limits.maxEstimatedUsd || next.run.metrics.elapsedMs >= next.run.limits.maxRuntimeMs) {
    next = failedModel(next, planning, end, "BUDGET_EXHAUSTED"); next.run.stopReason = next.run.metrics.elapsedMs >= next.run.limits.maxRuntimeMs ? "runtime_limit" : "cost_limit";
  } else {
    try {
      if (planning) {
        const plan = parsePlanResponse(result.raw, curatedTools(), next.symbols);
        next.run.plan = plan.tasks.map((task, i) => ({ ...task, id: "t" + String(i + 1).padStart(2, "0"), status: "pending", attempts: 0 }));
        validatePlan(next.run.plan, curatedTools()); next.run.title = plan.title; next.run.status = "awaiting_approval"; next.run.approved = false; delete next.run.stopReason; next.planning = false;
        next.run = addEvent(next.run, "planning_completed", "研究计划已生成，等待用户确认。", end, { limitations: plan.limitations });
      } else {
        const review = parseReviewResponse(result.raw, next.run.evidence.map(e => e.id));
        next.run = completeRun(next.run, buildResearchReport(next.run, review), end);
      }
    } catch { next = failedModel(next, planning, end, "INVALID_MODEL_OUTPUT"); }
  }
  if (!await repo.save(next, begun.run.version, leaseId)) return current(repo, begun);
  return next;
}

export async function advanceRun(repo: BuddyRepository, record: RunRecord, version: number, config: ModelConfig, dependencies: EngineDependencies = {}): Promise<RunRecord> {
  if (record.run.version !== version) throw new ServiceError(409, "VERSION_CONFLICT", "研究已更新，请刷新后重试。");
  if (["completed", "stopped"].includes(record.run.status) || (!record.planning && record.run.status !== "running")) throw new ServiceError(409, "INVALID_STATE", "当前研究不能继续执行。");
  const recovered = await recoverExpired(repo, record, dependencies); if (recovered) return recovered;
  const acquired = await repo.acquire(record.run.id, record.run.ownerId, record.run.mode, clock(dependencies));
  if (!acquired) throw new ServiceError(409, "BUSY", "该研究正在执行，请等待检查点返回。");
  const { leaseId } = acquired;
  try {
    record = acquired.record;
    if (record.run.version !== version) throw new ServiceError(409, "VERSION_CONFLICT", "研究已更新，请刷新后重试。");
    if (record.planning) return await modelStep(repo, record, leaseId, config, dependencies);
    if (!record.run.approved || record.run.status !== "running") throw new ServiceError(409, "INVALID_STATE", "计划尚未批准或研究已停止。");
    const task = record.run.plan.find(t => t.status !== "completed");
    if (!task) {
      if (record.run.mode === "live") return await modelStep(repo, record, leaseId, config, dependencies);
      const next = structuredClone(record); next.run = completeRun(next.run, buildResearchReport(next.run), nowText(dependencies));
      if (!await repo.save(next, record.run.version, leaseId)) return current(repo, record);
      return next;
    }
    const begun = structuredClone(record); begun.run = beginTask(begun.run, task.id, nowText(dependencies));
    if (!await repo.save(begun, record.run.version, leaseId)) return current(repo, record);
    if (begun.run.status !== "running") return begun;
    const startedTask = begun.run.plan.find(t => t.id === task.id)!;
    let evidence: Evidence | undefined, error: unknown;
    try {
      evidence = dependencies.execute ? await dependencies.execute(startedTask, begun.run.mode, begun.scenario, nowText(dependencies), config) : begun.run.mode === "demo" ? await executeDemo(startedTask, begun.scenario, nowText(dependencies)) : await executeTool(startedTask.tool, startedTask.arguments, config, { id: "e-" + startedTask.id, now: nowText(dependencies) });
    } catch (caught) { error = caught; }
    let latest = await current(repo, begun);
    if (latest.run.version === begun.run.version && latest.leaseId === leaseId && latest.leaseUntil <= clock(dependencies)) latest = await recoverExpired(repo, latest, dependencies) ?? latest;
    if (latest.run.version !== begun.run.version || latest.leaseId !== leaseId || latest.leaseUntil <= clock(dependencies)) return latest;
    const next = structuredClone(begun);
    if (evidence) {
      try { next.run = contextWithParent(succeedTask(next.run, task.id, [evidence], nowText(dependencies))).run; next.retryAt = 0; }
      catch { next.run = failTask(begun.run, task.id, "工具证据未通过完整性校验，研究未继续。", nowText(dependencies), false); }
    } else {
      const retryable = error instanceof ProviderError && error.retryable;
      next.run = failTask(next.run, task.id, retryable ? "接口暂时无法完成，已保留进度；请稍后恢复。" : "接口执行或数据校验失败，已保留进度。", nowText(dependencies), retryable);
      next.retryAt = retryable ? clock(dependencies) + Math.max(1000, (error as ProviderError).retryAfterMs) : 0;
    }
    try { if (!await repo.save(next, begun.run.version, leaseId)) return current(repo, begun); }
    catch {
      // Oversized raw evidence and immutable-evidence conflicts must not leave a fake success.
      const failed = structuredClone(begun); failed.run = failTask(failed.run, task.id, "证据无法安全保存（大小或完整性限制），研究已停止执行。", nowText(dependencies), false);
      if (!await repo.save(failed, begun.run.version, leaseId)) return current(repo, begun);
      return failed;
    }
    return next;
  } finally { await repo.release(record.run.id, record.run.ownerId, record.run.mode, leaseId); }
}
