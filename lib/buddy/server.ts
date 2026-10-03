import type { AgentTask, RunLimits, RunMode, Session } from "./types.ts";
import { BuddyRepository, type BuddyDatabase, type RunRecord } from "./repository.ts";
import { newSession, readSessionCookie, sessionCookie, signSession, verifySession } from "./auth.ts";
import { addEvent, approveRun, createRun, DEFAULT_LIMITS, HarnessError, stopRun, validatePlan } from "./harness.ts";
import { demoPlan } from "./demo.ts";
import { curatedTools, ProviderError } from "./providers.ts";
import { compareFinancials } from "./data.ts";
import { exportReport } from "./report.ts";
import { advanceRun, clock, dailyCap, resumeAtCheckpoint, ServiceError, tightened, userPause, type EngineDependencies } from "./engine.ts";
import type { ModelConfig } from "./model.ts";

type ConfigKey = "SESSION_SECRET" | "DEEPSEEK_API_KEY" | "DEEPSEEK_BASE_URL" | "DEEPSEEK_MODEL" | "DEEPSEEK_REASONING_EFFORT" | "FUYAO_API_KEY" | "IFIND_API_KEY" | "IFIND_MCP_BASE_URL" | "MODEL_INPUT_USD_PER_MILLION" | "MODEL_CACHED_INPUT_USD_PER_MILLION" | "MODEL_OUTPUT_USD_PER_MILLION" | "RUN_BUDGET_USD" | "DAILY_MODEL_BUDGET_USD";
export type BuddyEnv = Partial<Record<ConfigKey, string>> & { DB?: BuddyDatabase };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function json(data: unknown, status = 200, cookie?: string): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(cookie ? { "Set-Cookie": cookie } : {}) } });
}
function attachmentName(value: string): string { return encodeURIComponent(value).replace(/[!'()*]/g, char => "%" + char.charCodeAt(0).toString(16).toUpperCase()); }
function parentContext(parent: RunRecord): string {
  const context = { parentId: parent.run.id, summary: "", status: parent.run.status };
  let length = JSON.stringify(context).length;
  const source = parent.run.report?.summary ?? parent.run.contextSummary ?? "";
  // Count escaped JSON characters, preserving code points and the enclosing object.
  for (const char of source) {
    const escapedLength = JSON.stringify(char).length - 2;
    if (length + escapedLength > 6000) break;
    context.summary += char; length += escapedLength;
  }
  return JSON.stringify(context);
}
function bad(message = "请求参数无效，请检查输入。"): never { throw new ServiceError(400, "INVALID_INPUT", message); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) bad("请求体必须是 JSON 对象。"); return value as Record<string, unknown>; }
function fields(body: Record<string, unknown>, allowed: string[]): void { if (Object.keys(body).some(key => !allowed.includes(key))) bad("请求包含不支持的字段。"); }
function text(value: unknown, max: number): string { if (typeof value !== "string" || !value.trim() || value.length > max) bad("文本不能为空或超过长度限制。"); return value.trim(); }
function uuid(value: unknown): string { if (typeof value !== "string" || !UUID.test(value)) bad("记录标识必须是有效 UUID。"); return value; }
function version(body: Record<string, unknown>): number { if (!Number.isSafeInteger(body.version) || Number(body.version) < 0) bad("版本号必须是非负整数。"); return Number(body.version); }
function liveAvailable(env: BuddyEnv): boolean { return Boolean(env.DB && env.SESSION_SECRET && env.SESSION_SECRET.length >= 32 && env.DEEPSEEK_API_KEY?.trim() && env.FUYAO_API_KEY?.trim() && env.IFIND_API_KEY?.trim()); }
function config(env: BuddyEnv): ModelConfig { const result: ModelConfig = {}; for (const [key, value] of Object.entries(env)) if (key !== "DB" && typeof value === "string") result[key] = value; return result; }
function mutationGuard(request: Request): void {
  if (request.headers.get("X-Buddy-Client") !== "workbench" || request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new ServiceError(403, "CSRF", "请求来源或内容类型不符合工作台要求。");
  if (request.headers.get("Sec-Fetch-Site")?.toLowerCase() === "cross-site") throw new ServiceError(403, "CSRF", "不接受跨站请求。");
  const origin = request.headers.get("origin");
  if (origin !== null) { let matches = false; try { matches = new URL(origin).origin === new URL(request.url).origin && new URL(origin).origin === origin; } catch { /* Invalid origin is denied. */ } if (!matches) throw new ServiceError(403, "CSRF", "请求来源与工作台不一致。"); }
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const max = 16384;
  if (Number(request.headers.get("content-length")) > max) throw new ServiceError(413, "BODY_TOO_LARGE", "请求体超过 16KB 限制。");
  if (!request.body) bad("请求缺少 JSON 对象。");
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > max) { await reader.cancel(); throw new ServiceError(413, "BODY_TOO_LARGE", "请求体超过 16KB 限制。"); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); } catch (error) { if (error instanceof ServiceError) throw error; bad("请求体不是有效 JSON 对象。"); }
}
function modeFor(url: URL, bootstrap: boolean, session: Session): RunMode {
  const values = url.searchParams.getAll("mode");
  if (values.length > 1) bad("模式参数不能重复。");
  const mode = values[0] ?? (bootstrap ? "demo" : undefined);
  if (mode !== "demo" && mode !== "live") bad("请显式选择 demo 或 live 模式。");
  if (mode === "live" && session.mode !== "live") throw new ServiceError(403, "MODE_FORBIDDEN", "当前会话未获得真实研究权限。");
  return mode;
}
export function runView(record: RunRecord, now: number) {
  const { ownerId: _ownerId, ...publicRun } = record.run;
  void _ownerId;
  return { run: { ...publicRun, evidence: publicRun.evidence.map(e => ({ ...e, raw: null })) }, symbols: record.symbols, scenario: record.scenario, planning: record.planning, retryAt: record.retryAt, executing: Boolean(record.leaseId && record.leaseUntil > now), comparison: compareFinancials(record.run.evidence, record.symbols) };
}
async function owned(repo: BuddyRepository, id: string, session: Session, mode: RunMode): Promise<RunRecord> {
  uuid(id); const record = await repo.get(id, session.ownerId, mode);
  if (!record) throw new ServiceError(404, "NOT_FOUND", "研究不存在或不属于当前会话。");
  return record;
}
async function rate(repo: BuddyRepository, key: string, window: number, max: number, now: number): Promise<void> { if (!await repo.rateLimit(key, window, max, now)) throw new ServiceError(429, "RATE_LIMIT", "请求过于频繁，请稍后重试。"); }

export async function handleBuddy(request: Request, env: BuddyEnv, dependencies: EngineDependencies = {}): Promise<Response> {
  try {
    const now = clock(dependencies), at = new Date(now).toISOString(), url = new URL(request.url);
    const prefix = "/api/buddy/"; if (!url.pathname.startsWith(prefix)) throw new ServiceError(404, "NOT_FOUND", "接口不存在。");
    const path = url.pathname.slice(prefix.length).split("/").filter(Boolean), method = request.method;
    const mutation = method === "POST" || method === "DELETE";
    if (method !== "GET" && !mutation) throw new ServiceError(405, "METHOD_NOT_ALLOWED", "不支持此请求方法。");
    if (mutation) mutationGuard(request);
    if (!env.DB || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new ServiceError(503, "CONFIGURATION", "服务数据库或会话签名尚未配置。");
    const repo = new BuddyRepository(env.DB), cfg = config(env), bootstrap = path.length === 1 && path[0] === "bootstrap" && method === "GET";
    const token = readSessionCookie(request); let session = token ? await verifySession(token, env.SESSION_SECRET, now) : null;
    let cookie: string | undefined;
    if (!session && bootstrap) { session = newSession("demo", now); cookie = sessionCookie(await signSession(session, env.SESSION_SECRET), request.url); }
    if (!session) throw new ServiceError(401, "UNAUTHORIZED", "会话已失效，请刷新工作台。");
    // Live access is public; retain the signed browser owner and record isolation.
    if (bootstrap && url.searchParams.get("mode") === "live") {
      if (!liveAvailable(env)) throw new ServiceError(503, "CONFIGURATION", "真实研究尚未完成服务配置。");
      if (session.mode !== "live") { session = { ...session, mode: "live" }; cookie = sessionCookie(await signSession(session, env.SESSION_SECRET), request.url); }
    }
    const mode = modeFor(url, bootstrap, session);
    await rate(repo, `${mutation ? "mutation" : "get"}:${session.ownerId}`, 60000, mutation ? 40 : 60, now);
    const body = mutation ? await readBody(request) : undefined;
    if (bootstrap) {
      const [runs, memory] = await Promise.all([repo.list(session.ownerId, mode), repo.memories(session.ownerId, mode)]);
      return json({ session: { mode: session.mode, expiresAt: session.expiresAt }, runs, memory, tools: curatedTools(), limits: DEFAULT_LIMITS, capabilities: { liveAvailable: liveAvailable(env) }, ...(mode === "live" ? { dailyBudget: { ...await repo.budget(at.slice(0, 10)), cap: dailyCap(cfg) } } : {}) }, 200, cookie);
    }
    if (path.length === 1 && path[0] === "session" && method === "POST") {
      const input = body!;
      fields(input, ["mode"]);
      if (input.mode !== "demo" && input.mode !== "live") bad("请选择 demo 或 live 模式。");
      if (input.mode === "live") {
        const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
        await rate(repo, `switch-ip:${ip}`, 900000, 8, now); await rate(repo, `switch-owner:${session.ownerId}`, 900000, 8, now);
        if (!liveAvailable(env)) throw new ServiceError(503, "CONFIGURATION", "真实研究尚未完成服务配置。");
      }
      session = { ...session, mode: input.mode, expiresAt: now + 604800000 };
      return json({ session: { mode: session.mode, expiresAt: session.expiresAt } }, 200, sessionCookie(await signSession(session, env.SESSION_SECRET), request.url));
    }
    if (path[0] === "memory") {
      if (path.length === 1 && method === "GET") return json({ memory: await repo.memories(session.ownerId, mode) });
      if (path.length === 1 && method === "POST") {
        fields(body!, ["text", "kind", "confirmed"]); if (body!.confirmed !== true) bad("保存长期记忆需要显式确认。");
        if (body!.kind !== "preference" && body!.kind !== "research") bad("记忆类型无效。");
        if ((await repo.memories(session.ownerId, mode)).length >= 50) throw new ServiceError(409, "MEMORY_LIMIT", "长期记忆已达到 50 条上限。");
        await repo.addMemory(session.ownerId, mode, { id: crypto.randomUUID(), text: text(body!.text, 2000), kind: body!.kind, createdAt: at });
        return json({ memory: await repo.memories(session.ownerId, mode) }, 201);
      }
      if (path.length === 2 && method === "DELETE") { fields(body!, []); uuid(path[1]); if (!await repo.deleteMemory(session.ownerId, mode, path[1])) throw new ServiceError(404, "NOT_FOUND", "记忆不存在。"); return json({ memory: await repo.memories(session.ownerId, mode) }); }
    }
    if (path.length === 1 && path[0] === "runs" && method === "POST") {
      fields(body!, ["goal", "symbols", "scenario", "requestId", "parentId", "limits"]);
      const goal = text(body!.goal, 2000), id = uuid(body!.requestId);
      if (!Array.isArray(body!.symbols) || body!.symbols.length < 1 || body!.symbols.length > 3 || body!.symbols.some(s => typeof s !== "string" || !/^\d{6}\.(SH|SZ|BJ)$/.test(s))) bad("证券代码须为 1 至 3 个准确的六位代码与 SH/SZ/BJ 后缀。");
      const symbols = [...new Set(body!.symbols as string[])];
      const scenario = body!.scenario ?? "normal"; if (scenario !== "normal" && scenario !== "missing" && scenario !== "failure") bad("演示场景无效。");
      if (body!.parentId !== undefined) uuid(body!.parentId);
      const limits: Partial<RunLimits> = {};
      if (body!.limits !== undefined) {
        const supplied = object(body!.limits); fields(supplied, Object.keys(DEFAULT_LIMITS));
        for (const key of Object.keys(supplied) as (keyof RunLimits)[]) { const value = supplied[key]; if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > DEFAULT_LIMITS[key] || (key !== "maxEstimatedUsd" && !Number.isSafeInteger(value))) bad("研究限制只能收紧默认预算。"); limits[key] = value; }
      }
      limits.maxEstimatedUsd = Math.min(limits.maxEstimatedUsd ?? DEFAULT_LIMITS.maxEstimatedUsd, tightened(cfg.RUN_BUDGET_USD, 0.5));
      const existing = await repo.get(id, session.ownerId, mode); if (existing) return json(runView(existing, now));
      if (await env.DB.prepare("SELECT id FROM buddy_runs WHERE id=?").bind(id).first()) throw new ServiceError(409, "ID_CONFLICT", "此研究标识已存在，请使用新的请求标识。");
      if (mode === "live") { if (!liveAvailable(env)) throw new ServiceError(503, "CONFIGURATION", "真实研究尚未完成服务配置。"); await rate(repo, `create-live:${session.ownerId}`, 3600000, 6, now); }
      const plan: AgentTask[] = mode === "demo" ? demoPlan(symbols) : [{ id: "t01", title: "等待模型规划证券研究", tool: "fuyao_search", arguments: { query: symbols[0] }, status: "pending", attempts: 0 }];
      validatePlan(plan, curatedTools());
      const run = createRun({ id, ownerId: session.ownerId, goal, title: goal.slice(0, 60), mode, plan, now: at, limits, memory: await repo.memories(session.ownerId, mode) });
      if (body!.parentId !== undefined) { const parent = await owned(repo, body!.parentId as string, session, mode); run.parentId = parent.run.id; run.contextSummary = parentContext(parent); }
      const record: RunRecord = { run, symbols, scenario, planning: mode === "live", reviewAttempts: 0, retryAt: 0, leaseId: null, leaseUntil: 0 };
      try { await repo.insert(record); } catch { const raced = await repo.get(id, session.ownerId, mode); if (raced) return json(runView(raced, now)); if (await env.DB.prepare("SELECT id FROM buddy_runs WHERE id=?").bind(id).first()) throw new ServiceError(409, "ID_CONFLICT", "此研究标识已存在。"); throw new ServiceError(500, "STORAGE", "研究暂时无法保存，请稍后重试。"); }
      return json(runView(record, now), 201);
    }
    if (path[0] === "runs" && path.length >= 2) {
      const record = await owned(repo, path[1], session, mode);
      if (method === "GET" && path.length === 2) return json(runView(record, now));
      if (method === "GET" && path.length === 4 && path[2] === "evidence") { const evidence = record.run.evidence.find(e => e.id === path[3]); if (!evidence) throw new ServiceError(404, "NOT_FOUND", "证据不存在。"); return json(evidence); }
      if (method === "GET" && path.length === 3 && path[2] === "export") {
        const format = url.searchParams.get("format"); if (format !== "markdown" && format !== "json") bad("导出格式必须是 markdown 或 json。");
        if (record.run.status !== "completed") throw new ServiceError(409, "INVALID_STATE", "研究完成并通过报告校验后才能导出。");
        return new Response(exportReport(record.run, format), { headers: { "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="research.${format === "json" ? "json" : "md"}"; filename*=UTF-8''${attachmentName(record.run.title + (format === "json" ? ".json" : ".md"))}` } });
      }
      if (method === "POST" && path.length === 3 && ["approve", "advance", "pause", "resume", "stop", "replan"].includes(path[2])) {
        const action = path[2]; fields(body!, action === "approve" ? ["version", "approved"] : ["version"]); const expected = version(body!);
        if (expected !== record.run.version) throw new ServiceError(409, "VERSION_CONFLICT", "研究已更新，请刷新后重试。");
        if (action === "advance") { if (mode === "live" && !liveAvailable(env)) throw new ServiceError(503, "CONFIGURATION", "真实研究尚未完成服务配置。"); await advanceRun(repo, record, expected, cfg, dependencies); return json(runView(await owned(repo, path[1], session, mode), clock(dependencies))); }
        let next = structuredClone(record);
        if (action === "approve") {
          if (typeof body!.approved !== "boolean") bad("审批选择必须为布尔值。");
          if (record.planning || record.run.status !== "awaiting_approval") throw new ServiceError(409, "INVALID_STATE", "规划完成且待确认时才可审批。");
          validatePlan(record.run.plan, curatedTools()); const originalStartedAt = record.run.metrics.startedAt;
          next.run = approveRun(record.run, body!.approved, at); if (originalStartedAt) next.run.metrics.startedAt = originalStartedAt;
        } else if (action === "pause") next = userPause(record, at);
        else if (action === "resume") { if (record.retryAt > now) throw new ServiceError(409, "RETRY_WAIT", "接口要求稍后重试，请等待后再恢复。"); next.run = resumeAtCheckpoint(record, at); next.retryAt = 0; }
        else if (action === "stop") { next.run = stopRun(record.run, at); next.planning = false; }
        else {
          if (mode !== "live" || record.run.approved || record.planning || !["failed", "awaiting_approval", "paused"].includes(record.run.status)) throw new ServiceError(409, "INVALID_STATE", "当前研究不能重新规划。");
          if (record.run.metrics.modelCalls >= record.run.limits.maxModelCalls || record.run.metrics.estimatedUsd >= record.run.limits.maxEstimatedUsd) throw new ServiceError(409, "BUDGET_EXHAUSTED", "规划预算已用尽，不能重置计数。");
          next.planning = true; next.retryAt = 0; next.run.status = "awaiting_approval"; delete next.run.stopReason;
          next.run = addEvent(next.run, "replan_requested", "用户请求重新规划，历史调用与费用保留。", at);
        }
        if (next.run.version === record.run.version) return json(runView(record, now));
        if (!await repo.save(next, expected)) throw new ServiceError(409, "VERSION_CONFLICT", "研究已更新，请刷新后重试。");
        return json(runView(await owned(repo, path[1], session, mode), now));
      }
    }
    throw new ServiceError(404, "NOT_FOUND", "接口不存在。");
  } catch (error) {
    if (error instanceof ServiceError) return json({ error: { code: error.code, message: error.message } }, error.status);
    if (error instanceof HarnessError) { const invalid = ["INVALID_INPUT", "INVALID_LIMITS", "INVALID_PLAN", "INVALID_ARGUMENTS", "UNKNOWN_TOOL", "INVALID_SCHEMA"].includes(error.code); return json({ error: { code: error.code, message: invalid ? "请求或研究计划未通过校验。" : error.code === "BUDGET_EXHAUSTED" ? "研究预算已用尽，恢复不能重置预算。" : "当前研究状态不允许此操作。" } }, invalid ? 400 : 409); }
    if (error instanceof ProviderError) return json({ error: { code: error.code, message: error.code === "CONFIGURATION" ? "服务配置尚未完成。" : "输入或数据未通过校验，研究未执行。" } }, error.code === "CONFIGURATION" ? 503 : 400);
    return json({ error: { code: "INTERNAL", message: "服务暂时无法完成请求，已保存的进度仍可恢复。" } }, 500);
  }
}
