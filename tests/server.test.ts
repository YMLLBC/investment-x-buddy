import test from "node:test";
import assert from "node:assert/strict";
import { sqliteD1 } from "./support/d1.ts";
import { BuddyRepository } from "../lib/buddy/repository.ts";
import { executeDemo } from "../lib/buddy/demo.ts";
import { validateReport } from "../lib/buddy/report.ts";
import { signSession, newSession } from "../lib/buddy/auth.ts";
import type { AgentTask, Evidence } from "../lib/buddy/types.ts";
import type { BuddyEnv, runView } from "../lib/buddy/server.ts";
import type { Bootstrap } from "../lib/buddy/client.ts";
import type { AgentEvent, ResearchClaim, ResearchReport } from "../lib/buddy/types.ts";
import type { EngineDependencies } from "../lib/buddy/engine.ts";
import { modelReservation } from "../lib/buddy/model.ts";
import { ProviderError } from "../lib/buddy/providers.ts";

const secret = "test-session-secret-32-characters-long";
const symbols = ["600519.SH", "000858.SZ", "000568.SZ"];
type View = ReturnType<typeof runView>;
type TestJson = View & Bootstrap & { raw: Record<string, unknown>; report: ResearchReport; evidence: Evidence[] };
async function setup(dependencies: EngineDependencies = {}, overrides: Partial<BuddyEnv> = {}) {
  const { db, sqlite } = sqliteD1();
  let server: typeof import("../lib/buddy/server.ts");
  try { server = await import("../lib/buddy/server.ts"); }
  catch { assert.fail("服务入口尚未实现：应导出 handleBuddy 并支持真实 SQLite 演示链路"); }
  let cookie = "";
  const env: BuddyEnv = { DB: db, SESSION_SECRET: secret, ...overrides };
  async function req<T = TestJson>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", extra: Record<string, string> = {}) {
    const response = await server.handleBuddy(new Request("https://buddy.test/api/buddy/" + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json", "X-Buddy-Client": "workbench" } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, dependencies);
    const issued = response.headers.get("set-cookie"); if (issued) cookie = issued.split(";", 1)[0];
    assert.equal(response.headers.get("cache-control"), "no-store");
    const data = ((response.headers.get("content-type") ?? "").includes("application/json") ? await response.json() : await response.text()) as T;
    return { response, data };
  }
  await req("bootstrap?mode=demo");
  async function create(scenario = "normal", limits?: object, goal = "比较盈利质量与现金流"): Promise<View> { const r = await req("runs?mode=demo", { goal, symbols, scenario, requestId: crypto.randomUUID(), ...(limits ? { limits } : {}) }); assert.equal(r.response.status, 201); return r.data; }
  async function act(view: View, action: string, extras = {}) { return req("runs/" + view.run.id + "/" + action + "?mode=demo", { version: view.run.version, ...extras }); }
  async function finish(view: View) { for (let i = 0; i < 30 && view.run.status === "running"; i++) { const r = await act(view, "advance"); assert.equal(r.response.status, 200); view = r.data; } return view; }
  return { db, sqlite, req, create, act, finish, env, repo: new BuddyRepository(db), cookie: () => cookie, server };
}
const liveConfig = { DEEPSEEK_API_KEY: "synthetic-model-test", FUYAO_API_KEY: "synthetic-finance-test", IFIND_API_KEY: "synthetic-mcp-test" };
const functionCall = (name: string, args: unknown) => ({ status: "completed", output: [{ type: "function_call", name, arguments: JSON.stringify(args) }] });
const planOutput = () => functionCall("propose_research_plan", { title: "现金流研究", tasks: ["income", "cashflow", "valuation"].map(k => ({ title: k, tool: "fuyao_" + k, arguments_json: JSON.stringify({ symbol: "600519.SH" }) })), limitations: [] });
const actualUsage = { inputTokens: 100, outputTokens: 20, estimatedUsd: 0.000054 };
async function createLive(s: Awaited<ReturnType<typeof setup>>) {
  assert.equal((await s.req("session?mode=demo", { mode: "live" })).response.status, 200);
  const r = await s.req("runs?mode=live", { goal: "年度现金流研究", symbols: ["600519.SH"], requestId: crypto.randomUUID() }); assert.equal(r.response.status, 201); return r.data;
}
async function liveAct(s: Awaited<ReturnType<typeof setup>>, v: View, action: string, extras = {}) { return s.req(`runs/${v.run.id}/${action}?mode=live`, { version: v.run.version, ...extras }); }

test("授权 demo 全流程生成真实构造证据、有效引用及两种导出", async () => {
  const s = await setup();
  try {
    const boot = await s.req("bootstrap?mode=demo"); assert.equal(boot.data.capabilities.liveAvailable, false); assert.deepEqual(Object.keys(boot.data.session).sort(), ["expiresAt", "mode"]);
    let view = await s.create("normal", undefined, "比较盈利质量与现金流'()*"); assert.equal(view.run.approved, false); assert.equal("ownerId" in view.run, false);
    const duplicate = await s.req("runs?mode=demo", { goal: "ignored duplicate", symbols, requestId: view.run.id }); assert.equal(duplicate.response.status, 200); assert.equal(duplicate.data.run.goal, view.run.goal);
    view = (await s.act(view, "approve", { approved: true })).data;
    view = await s.finish(view); assert.equal(view.run.status, "completed"); assert.equal(view.run.metrics.modelCalls, 0); assert.equal(view.run.metrics.estimatedUsd, 0); assert.equal(view.run.metrics.toolCalls, view.run.plan.length);
    assert.ok(view.run.evidence.every((e: Evidence) => e.raw === null));
    const full = await s.req(`runs/${view.run.id}/evidence/${view.run.evidence[0].id}?mode=demo`); assert.equal(full.data.raw.constructed, true);
    const refreshed = (await s.req(`runs/${view.run.id}?mode=demo`)).data; assert.deepEqual(refreshed, view);
    const owner = JSON.parse(Buffer.from(s.cookie().split("=", 2)[1].split(".")[0], "base64url").toString()).ownerId;
    const stored = (await s.repo.get(view.run.id, owner, "demo"))!; validateReport(stored.run.report!, stored.run.evidence);
    const exported = await s.req(`runs/${view.run.id}/export?mode=demo&format=json`); assert.equal(exported.response.status, 200); assert.equal(exported.data.evidence.length, view.run.evidence.length); assert.deepEqual(exported.data.report, view.run.report); assert.ok(exported.data.report.claims.every((c: ResearchClaim) => c.evidenceIds.every((id: string) => exported.data.evidence.some((e: Evidence) => e.id === id))));
    const markdown = await s.req<string>(`runs/${view.run.id}/export?mode=demo&format=markdown`); assert.equal(markdown.response.status, 200); assert.ok(markdown.data.includes("citations:")); assert.ok(markdown.response.headers.get("content-disposition")?.includes("filename*=UTF-8''"));
    assert.ok(markdown.response.headers.get("content-disposition")?.includes("%27%28%29%2A"));
  } finally { s.sqlite.close(); }
});

test("missing 保留 null 并明确 unknown", async () => {
  const s = await setup(); try { let v = await s.create("missing"); v = (await s.act(v, "approve", { approved: true })).data; v = await s.finish(v); assert.equal(v.run.status, "completed"); assert.equal(v.comparison.rows[2].cashflow, null); assert.ok(v.run.report!.claims.some((c: ResearchClaim) => c.kind === "unknown")); } finally { s.sqlite.close(); }
});

test("failure 暂停，显式 resume 保留计数和已完成证据", async () => {
  const s = await setup(); try { let v = await s.create("failure"); v = (await s.act(v, "approve", { approved: true })).data; v = await s.finish(v); assert.equal(v.run.status, "paused"); const count = v.run.metrics.toolCalls, evidence = v.run.evidence.length; assert.equal((await s.act(v, "resume")).response.status, 409); await s.repo.get(v.run.id, "invalid", "demo"); await new Promise(r => setTimeout(r, 1050)); v = (await s.act(v, "resume")).data; assert.equal(v.run.metrics.toolCalls, count); assert.equal(v.run.evidence.length, evidence); v = await s.finish(v); assert.equal(v.run.status, "completed"); assert.equal(v.run.metrics.toolCalls, v.run.plan.length + 1); } finally { s.sqlite.close(); }
});

test("拒绝计划无工具调用；tighten 单工具预算不能 resume 重置", async () => {
  const s = await setup(); try { let v = await s.create(); v = (await s.act(v, "approve", { approved: false })).data; assert.equal(v.run.status, "stopped"); assert.equal((await s.act(v, "advance")).response.status, 409); assert.equal(v.run.metrics.toolCalls, 0); v = await s.create("normal", { maxToolCalls: 1 }); v = (await s.act(v, "approve", { approved: true })).data; v = (await s.act(v, "advance")).data; v = (await s.act(v, "advance")).data; assert.equal(v.run.status, "paused"); assert.equal(v.run.stopReason, "tool_limit"); assert.equal((await s.act(v, "resume")).response.status, 409); assert.equal(v.run.metrics.toolCalls, 1); } finally { s.sqlite.close(); }
});

test("跨 owner/mode scope、live 未配置和 CSRF 均拒绝", async () => {
  const s = await setup(); try { const v = await s.create(); const other = await signSession(newSession("demo", Date.now()), secret); assert.equal((await s.req(`runs/${v.run.id}?mode=demo`, undefined, "GET", { Cookie: "buddy_session=" + other })).response.status, 404); assert.equal((await s.req("runs?mode=demo", { goal: "不同 owner", symbols, requestId: v.run.id }, "POST", { Cookie: "buddy_session=" + other })).response.status, 409); assert.equal((await s.req(`runs/${v.run.id}?mode=live`)).response.status, 403); assert.equal((await s.req("session?mode=demo", { mode: "live" })).response.status, 503); assert.equal((await s.req("memory?mode=demo", { text: "x", kind: "research", confirmed: true }, "POST", { Origin: "https://evil.test" })).response.status, 403); assert.equal((await s.req("memory?mode=demo", { text: "x", kind: "research", confirmed: true }, "POST", { "Sec-Fetch-Site": "cross-site" })).response.status, 403); assert.equal((await s.req("memory?mode=demo", { text: "x", kind: "research", confirmed: true }, "POST", { "X-Buddy-Client": "invalid" })).response.status, 403); } finally { s.sqlite.close(); }
});

test("显式 memory 确认、快照及删除 scope", async () => {
  const s = await setup(); try { assert.equal((await s.req("memory?mode=demo", { text: "偏好现金流", kind: "preference" })).response.status, 400); const added = await s.req("memory?mode=demo", { text: "偏好现金流", kind: "preference", confirmed: true }); assert.equal(added.data.memory.length, 1); const id = added.data.memory[0].id; const v = await s.create(); assert.equal(v.run.memory.length, 1); const other = await signSession(newSession("demo", Date.now()), secret); assert.equal((await s.req(`memory/${id}?mode=demo`, {}, "DELETE", { Cookie: "buddy_session=" + other })).response.status, 404); assert.equal((await s.req(`memory/${id}?mode=demo`, {}, "DELETE")).data.memory.length, 0); assert.equal((await s.req(`runs/${v.run.id}?mode=demo`)).data.run.memory.length, 1); } finally { s.sqlite.close(); }
});

test("请求体、符号、字段和版本边界拒绝", async () => {
  const s = await setup(); try { assert.equal((await s.req("runs?mode=demo", { goal: "x".repeat(17000), symbols, requestId: crypto.randomUUID() })).response.status, 413); for (const changes of [{ symbols: ["600519"] }, { symbols: [] }, { goal: 5 }, { requestId: "bad" }, { limits: { maxToolCalls: 25 } }, { unexpected: true }]) assert.equal((await s.req("runs?mode=demo", { goal: "研究", symbols, requestId: crypto.randomUUID(), ...changes })).response.status, 400); const v = await s.create(); assert.equal((await s.act(v, "approve", { approved: true, version: -1 })).response.status, 400); assert.equal((await s.act(v, "approve", { approved: true, version: 999 })).response.status, 409); assert.equal((await s.req(`runs/${v.run.id}`)).response.status, 400); } finally { s.sqlite.close(); }
});

test("SQLite CAS stop 后迟到结果不增加证据，并发 advance 只有一次调用", async () => {
  let release!: () => void, started!: () => void, calls = 0;
  const wait = new Promise<void>(r => { release = r; }); const began = new Promise<void>(r => { started = r; });
  const s = await setup({ execute: async (task: AgentTask, _mode: string, scenario: "normal" | "missing" | "failure", now: string) => { calls++; started(); await wait; return executeDemo(task, scenario, now); } });
  try { let v = await s.create(); v = (await s.act(v, "approve", { approved: true })).data; const pending = s.act(v, "advance"); await began; const current = (await s.req(`runs/${v.run.id}?mode=demo`)).data; assert.equal(current.executing, true); assert.equal((await s.act(current, "advance")).response.status, 409); const stopped = (await s.act(current, "stop")).data; assert.equal(stopped.run.status, "stopped"); release(); const late = await pending; assert.equal(late.response.status, 200); assert.equal(late.data.run.status, "stopped"); assert.equal(late.data.run.evidence.length, 0); assert.equal(late.data.executing, false); assert.equal(calls, 1); } finally { release(); s.sqlite.close(); }
});

test("过期 lease 的 running task 先暂停，明确恢复后才重试", async () => {
  const s = await setup(); try { let v = await s.create(); v = (await s.act(v, "approve", { approved: true })).data; const owner = JSON.parse(Buffer.from(s.cookie().split("=", 2)[1].split(".")[0], "base64url").toString()).ownerId; const record = (await s.repo.get(v.run.id, owner, "demo"))!; const { beginTask } = await import("../lib/buddy/harness.ts"); const expired = (await s.repo.acquire(v.run.id, owner, "demo", Date.now() - 200000))!; record.run = beginTask(record.run, record.run.plan[0].id, new Date().toISOString()); assert.equal(await s.repo.save(record, v.run.version, expired.leaseId), true); const current = (await s.req(`runs/${v.run.id}?mode=demo`)).data; const recovered = await s.act(current, "advance"); assert.equal(recovered.data.run.status, "paused"); assert.equal(recovered.data.run.metrics.toolCalls, 1); assert.equal(recovered.data.run.evidence.length, 0); v = (await s.act(recovered.data, "resume")).data; v = (await s.act(v, "advance")).data; assert.equal(v.run.metrics.toolCalls, 2); assert.equal(v.run.evidence.length, 1); } finally { s.sqlite.close(); }
});

test("live 同 owner 升降级、demo 访问及 parent scope 保持隔离", async () => {
  const s = await setup({}, liveConfig);
  try {
    const demo = await s.create(); const oldOwner = s.cookie().split("=", 2)[1].split(".")[0];
    const live = await createLive(s); assert.equal(live.planning, true); assert.equal(live.run.approved, false);
    assert.equal((await s.req(`runs/${demo.run.id}?mode=demo`)).response.status, 200);
    assert.equal((await s.req(`runs/${demo.run.id}?mode=live`)).response.status, 404);
    assert.equal((await liveAct(s, live, "approve", { approved: true })).response.status, 409);
    const downgraded = await s.req("session?mode=live", { mode: "demo" }); assert.equal(downgraded.data.session.mode, "demo");
    assert.equal((await s.req(`runs/${live.run.id}?mode=live`)).response.status, 403);
    await s.req("session?mode=demo", { mode: "live" }); assert.equal((await s.req(`runs/${live.run.id}?mode=live`)).response.status, 200);
    assert.equal(JSON.parse(Buffer.from(oldOwner, "base64url").toString()).ownerId, JSON.parse(Buffer.from(s.cookie().split("=", 2)[1].split(".")[0], "base64url").toString()).ownerId);
    assert.equal((await s.req("runs?mode=live", { goal: "父研究", symbols: ["600519.SH"], requestId: crypto.randomUUID(), parentId: demo.run.id })).response.status, 404);
  } finally { s.sqlite.close(); }
});

test("live 未审批规划先落盘预留，成功按 actual 结算且失败不免费重试", async () => {
  let calls = 0, reserved = 0;
  const s: Awaited<ReturnType<typeof setup>> = await setup({ model: async payload => {
    calls++; const listed = (await s.req("bootstrap?mode=live")).data; const summary = listed.runs[0];
    const persisted = (await s.req(`runs/${summary.id}?mode=live`)).data;
    assert.equal(persisted.run.approved, false); assert.equal(persisted.run.metrics.modelCalls, calls);
    assert.ok(persisted.run.events.some((e: AgentEvent) => e.type === "planning_started"));
    assert.ok(listed.dailyBudget); assert.ok(listed.dailyBudget.reserved > 0); reserved = modelReservation(payload, Number(payload.max_output_tokens), {});
    if (calls > 1) throw new ProviderError("TIMEOUT", "synthetic unknown usage", true);
    return { raw: planOutput(), usage: actualUsage };
  } }, liveConfig);
  try {
    let v = await createLive(s); v = (await liveAct(s, v, "advance")).data;
    assert.equal(v.planning, false); assert.equal(v.run.status, "awaiting_approval"); assert.equal(v.run.metrics.modelCalls, 1); assert.equal(v.run.metrics.estimatedUsd, actualUsage.estimatedUsd);
    assert.deepEqual((await s.repo.budget(new Date().toISOString().slice(0, 10))), { spent: actualUsage.estimatedUsd, reserved: 0 });
    v = (await liveAct(s, v, "replan")).data; assert.equal(v.run.metrics.modelCalls, 1); v = (await liveAct(s, v, "advance")).data;
    assert.equal(v.run.status, "failed"); assert.equal(v.run.approved, false); assert.equal(v.planning, false); assert.equal(v.run.metrics.modelCalls, 2); assert.ok(Math.abs(v.run.metrics.estimatedUsd - actualUsage.estimatedUsd - reserved) < 1e-12);
    assert.ok(v.run.events.some((e: AgentEvent) => e.type === "model_usage" && e.details?.billing === "unknown"));
    assert.equal((await liveAct(s, v, "advance")).response.status, 409); assert.equal(calls, 2);
  } finally { s.sqlite.close(); }
});

test("live 单研究和每日预算都在模型调用前阻断；model 总 4 次含失败", async () => {
  for (const budget of [{ RUN_BUDGET_USD: "0.000001" }, { DAILY_MODEL_BUDGET_USD: "0.000001" }]) {
    let calls = 0; const s = await setup({ model: async () => { calls++; return { raw: planOutput(), usage: actualUsage }; } }, { ...liveConfig, ...budget });
    try { let v = await createLive(s); v = (await liveAct(s, v, "advance")).data; assert.equal(v.run.status, "failed"); assert.equal(calls, 0); assert.equal(v.run.metrics.modelCalls, 0); assert.deepEqual(await s.repo.budget(new Date().toISOString().slice(0, 10)), { spent: 0, reserved: 0 }); } finally { s.sqlite.close(); }
  }
  let calls = 0; const s = await setup({ model: async () => { calls++; throw new ProviderError("TIMEOUT", "unknown usage", true); } }, liveConfig);
  try { let v = await createLive(s); for (let i = 0; i < 4; i++) { v = (await liveAct(s, v, "advance")).data; assert.equal(v.run.metrics.modelCalls, i + 1); if (i < 3) v = (await liveAct(s, v, "replan")).data; } assert.equal((await liveAct(s, v, "replan")).response.status, 409); assert.equal(calls, 4); } finally { s.sqlite.close(); }
});

test("live 模型停止后迟到仍结算日账本，只补用量不复活研究", async () => {
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>(r => { release = r; }), began = new Promise<void>(r => { started = r; });
  const s = await setup({ model: async () => { started(); await waiting; return { raw: planOutput(), usage: actualUsage }; } }, liveConfig);
  try { const v = await createLive(s); const pending = liveAct(s, v, "advance"); await began; const current = (await s.req(`runs/${v.run.id}?mode=live`)).data; assert.equal((await liveAct(s, current, "stop")).data.run.status, "stopped"); release(); const late = (await pending).data; assert.equal(late.run.status, "stopped"); assert.equal(late.planning, false); assert.equal(late.run.report, undefined); assert.equal(late.run.evidence.length, 0); assert.equal(late.run.metrics.modelCalls, 1); assert.equal(late.run.metrics.estimatedUsd, actualUsage.estimatedUsd); assert.deepEqual(await s.repo.budget(new Date().toISOString().slice(0, 10)), { spent: actualUsage.estimatedUsd, reserved: 0 }); } finally { release(); s.sqlite.close(); }
});

test("live review 12000 预留，错误引用仍收费且不得 completed", async () => {
  let calls = 0; const capacities: number[] = [];
  const s = await setup({ execute: (task, _mode, scenario, now) => executeDemo(task, scenario, now), model: async payload => { calls++; capacities.push(Number(payload.max_output_tokens)); return { raw: calls === 1 ? planOutput() : functionCall("write_evidence_review", { summary: "待核验", claims: [{ kind: "inference", text: "现金流需核验。", evidence_ids: [calls === 2 ? "invented-id" : "e-t01"] }], limitations: [], questions: [] }), usage: actualUsage }; } }, liveConfig);
  try { let v = await createLive(s); v = (await liveAct(s, v, "advance")).data; v = (await liveAct(s, v, "approve", { approved: true })).data; for (let i = 0; i < 4; i++) v = (await liveAct(s, v, "advance")).data; assert.equal(v.run.status, "paused"); assert.equal(v.run.stopReason, "model_failure"); assert.equal(v.run.report, undefined); assert.equal(v.run.metrics.modelCalls, 2); assert.equal((await s.req(`runs/${v.run.id}/export?mode=live&format=json`)).response.status, 409); v = (await liveAct(s, v, "resume")).data; v = (await liveAct(s, v, "advance")).data; assert.equal(v.run.status, "completed"); assert.deepEqual(capacities, [3000, 12000, 12000]); assert.equal(v.run.metrics.modelCalls, 3); assert.equal(v.run.metrics.inputTokens, 300); assert.ok(v.run.report!.claims.some((c: ResearchClaim) => c.kind === "inference" && c.evidenceIds.includes("e-t01"))); } finally { s.sqlite.close(); }
});

test("未审批规划 pause 保持用户暂停，manual replan 保留用量且旧请求不能覆盖", async () => {
  let release!: () => void, started!: () => void, calls = 0;
  const waiting = new Promise<void>(r => { release = r; }), began = new Promise<void>(r => { started = r; });
  const s = await setup({ model: async () => { calls++; if (calls === 1) { started(); await waiting; } return { raw: planOutput(), usage: actualUsage }; } }, liveConfig);
  try { let v = await createLive(s); const pending = liveAct(s, v, "advance"); await began; v = (await s.req(`runs/${v.run.id}?mode=live`)).data; v = (await liveAct(s, v, "pause")).data; assert.equal(v.run.status, "paused"); assert.equal(v.run.stopReason, "user_paused"); assert.equal(v.run.approved, false); assert.equal(v.planning, false); assert.equal(v.executing, false); assert.equal((await liveAct(s, v, "resume")).response.status, 409); release(); v = (await pending).data; assert.equal(v.run.status, "paused"); assert.equal(v.run.metrics.modelCalls, 1); assert.equal(v.run.metrics.estimatedUsd, actualUsage.estimatedUsd); v = (await liveAct(s, v, "replan")).data; assert.equal(v.planning, true); assert.equal(v.run.metrics.modelCalls, 1); v = (await liveAct(s, v, "advance")).data; assert.equal(v.run.status, "awaiting_approval"); assert.equal(v.run.metrics.modelCalls, 2); } finally { release(); s.sqlite.close(); }
});

test("模型复核返回时 lease 已过期，结算用量后必须暂停而不能自动重发", async () => {
  let now = Date.now(), calls = 0;
  const s = await setup({ now: () => now, execute: (task, _mode, scenario, at) => executeDemo(task, scenario, at), model: async () => { calls++; if (calls === 1) return { raw: planOutput(), usage: actualUsage }; now += 180001; return { raw: functionCall("write_evidence_review", { summary: "核验完成", claims: [], limitations: [], questions: [] }), usage: actualUsage }; } }, liveConfig);
  try { let v = await createLive(s); v = (await liveAct(s, v, "advance")).data; v = (await liveAct(s, v, "approve", { approved: true })).data; for (let i = 0; i < 4; i++) v = (await liveAct(s, v, "advance")).data; assert.equal(v.run.status, "paused"); assert.equal(v.run.stopReason, "lease_expired"); assert.equal(v.run.metrics.modelCalls, 2); assert.equal(v.run.report, undefined); assert.equal((await liveAct(s, v, "advance")).response.status, 409); assert.equal(calls, 2); } finally { s.sqlite.close(); }
});

test("工具返回时 lease 已过期，先标记暂停且 resume 不重置已消耗工具计数", async () => {
  let now = Date.now(), calls = 0;
  const s = await setup({ now: () => now, execute: async (task, _mode, scenario, at) => { calls++; now += 180001; return executeDemo(task, scenario, at); } });
  try { let v = await s.create(); v = (await s.act(v, "approve", { approved: true })).data; v = (await s.act(v, "advance")).data; assert.equal(v.run.status, "paused"); assert.equal(v.run.stopReason, "lease_expired"); assert.equal(v.run.evidence.length, 0); assert.equal(v.run.metrics.toolCalls, 1); assert.equal((await s.act(v, "advance")).response.status, 409); v = (await s.act(v, "resume")).data; assert.equal(v.run.plan[0].status, "pending"); assert.equal(v.run.metrics.toolCalls, 1); assert.equal(calls, 1); } finally { s.sqlite.close(); }
});

test("父研究摘要绑定规划和压缩后复核上下文，不能跨 mode 复用", async () => {
  const inputs: string[] = [];
  const s = await setup({ execute: async (task, _mode, scenario, at) => { const evidence = await executeDemo(task, scenario, at); return { ...evidence, summary: "材料".repeat(4500) }; }, model: async payload => { inputs.push(String(payload.input)); return { raw: inputs.length === 1 ? planOutput() : functionCall("write_evidence_review", { summary: "核验后的父研究摘要", claims: [], limitations: [], questions: [] }), usage: actualUsage }; } }, liveConfig);
  try {
    const parent = await createLive(s);
    const owner = JSON.parse(Buffer.from(s.cookie().split("=", 2)[1].split(".")[0], "base64url").toString()).ownerId;
    const record = (await s.repo.get(parent.run.id, owner, "live"))!; record.run.contextSummary = "父研究重要约束";
    const { addEvent } = await import("../lib/buddy/harness.ts"); record.run = addEvent(record.run, "context_saved", "已保存摘要", new Date().toISOString()); assert.equal(await s.repo.save(record, 0), true);
    let child = (await s.req("runs?mode=live", { goal: "延续父研究", symbols: ["600519.SH"], parentId: parent.run.id, requestId: crypto.randomUUID() })).data;
    assert.ok(child.run.contextSummary.includes("父研究重要约束")); child = (await liveAct(s, child, "advance")).data;
    assert.ok(inputs[0].includes("父研究重要约束"));
    child = (await liveAct(s, child, "approve", { approved: true })).data;
    for (let i = 0; i < 3; i++) child = (await liveAct(s, child, "advance")).data;
    assert.ok(child.run.contextSummary.includes("父研究重要约束"));
    child = (await liveAct(s, child, "advance")).data; assert.equal(child.run.status, "completed"); assert.ok(inputs[1].includes("父研究重要约束"));
  } finally { s.sqlite.close(); }
});

test("GET/mutation/模式切换/live创建限流持久化，窗口过后恢复", async () => {
  let now = Date.now(); const s = await setup({ now: () => now }, liveConfig);
  try {
    for (let i = 0; i < 59; i++) assert.equal((await s.req("memory?mode=demo")).response.status, 200);
    assert.equal((await s.req("memory?mode=demo")).response.status, 429); now += 60000;
    assert.equal((await s.req("memory?mode=demo")).response.status, 200);
    for (let i = 0; i < 8; i++) assert.equal((await s.req("session?mode=demo", { mode: "live" })).response.status, 200);
    assert.equal((await s.req("session?mode=demo", { mode: "live" })).response.status, 429); now += 900000;
    assert.equal((await s.req("session?mode=demo", { mode: "live" })).response.status, 200);
    for (let i = 0; i < 6; i++) assert.equal((await s.req("runs?mode=live", { goal: "研究", symbols: ["600519.SH"], requestId: crypto.randomUUID() })).response.status, 201);
    assert.equal((await s.req("runs?mode=live", { goal: "研究", symbols: ["600519.SH"], requestId: crypto.randomUUID() })).response.status, 429);
    now += 60000;
    for (let i = 0; i < 40; i++) assert.equal((await s.req("memory?mode=demo", { text: "x", kind: "research" })).response.status, 400);
    assert.equal((await s.req("memory?mode=demo", { text: "x", kind: "research" })).response.status, 429);
  } finally { s.sqlite.close(); }
});

test("签名配置缺失拒绝，不接受伪造会话；stream 体积和 UTF-8 严格拒绝", async () => {
  const s = await setup();
  try {
    const missing = await s.server.handleBuddy(new Request("https://buddy.test/api/buddy/bootstrap"), { DB: s.db }); assert.equal(missing.status, 503); assert.equal(missing.headers.get("cache-control"), "no-store");
    assert.equal((await s.req("memory?mode=demo", undefined, "GET", { Cookie: "buddy_session=forged.signature" })).response.status, 401);
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(10000)); controller.enqueue(new Uint8Array(10000)); controller.close(); } });
    const oversized = await s.server.handleBuddy(new Request("https://buddy.test/api/buddy/memory?mode=demo", { method: "POST", headers: { Cookie: s.cookie(), "Content-Type": "application/json", "X-Buddy-Client": "workbench" }, body: stream, duplex: "half" } as RequestInit), s.env); assert.equal(oversized.status, 413);
    const invalid = await s.server.handleBuddy(new Request("https://buddy.test/api/buddy/memory?mode=demo", { method: "POST", headers: { Cookie: s.cookie(), "Content-Type": "application/json", "X-Buddy-Client": "workbench" }, body: new Uint8Array([0xff]) }), s.env); assert.equal(invalid.status, 400);
    assert.equal((await s.req("memory?mode=demo", [], "POST")).response.status, 400);
    assert.equal((await s.req("memory?mode=demo", {}, "POST", { "Content-Type": "text/plain" })).response.status, 403);
  } finally { s.sqlite.close(); }
});

test("旧规划迟到会计与新规划并发时，CAS 不覆盖检查点且不静默再次规划", async () => {
  const releases: (() => void)[] = [], starts: (() => void)[] = []; let calls = 0;
  const waiting = [0, 1].map(i => new Promise<void>(r => { releases[i] = r; })); const began = [0, 1].map(i => new Promise<void>(r => { starts[i] = r; }));
  const s = await setup({ model: async () => { const i = calls++; starts[i](); await waiting[i]; return { raw: planOutput(), usage: actualUsage }; } }, liveConfig);
  try { let v = await createLive(s); const old = liveAct(s, v, "advance"); await began[0]; v = (await s.req(`runs/${v.run.id}?mode=live`)).data; v = (await liveAct(s, v, "pause")).data; v = (await liveAct(s, v, "replan")).data; const active = liveAct(s, v, "advance"); await began[1]; releases[0](); await old; releases[1](); v = (await active).data; assert.equal(v.planning, false); assert.equal(v.run.status, "failed"); assert.equal(v.run.metrics.modelCalls, 2); assert.equal((await liveAct(s, v, "advance")).response.status, 409); assert.equal(calls, 2); assert.ok(Math.abs(v.run.metrics.estimatedUsd - 2 * actualUsage.estimatedUsd) < 1e-12); } finally { releases.forEach(r => r()); s.sqlite.close(); }
});

test("已落盘 running task 即使 lease 丢失也必须明确恢复，不能重发", async () => {
  const s = await setup(); try { let v = await s.create(); v = (await s.act(v, "approve", { approved: true })).data; const owner = JSON.parse(Buffer.from(s.cookie().split("=", 2)[1].split(".")[0], "base64url").toString()).ownerId; const record = (await s.repo.get(v.run.id, owner, "demo"))!; const { beginTask } = await import("../lib/buddy/harness.ts"); record.run = beginTask(record.run, record.run.plan[0].id, new Date().toISOString()); assert.equal(await s.repo.save(record, v.run.version), true); v = (await s.req(`runs/${v.run.id}?mode=demo`)).data; const interrupted = await s.act(v, "advance"); assert.equal(interrupted.response.status, 200); assert.equal(interrupted.data.run.status, "paused"); assert.equal(interrupted.data.run.metrics.toolCalls, 1); assert.equal(interrupted.data.run.evidence.length, 0); } finally { s.sqlite.close(); }
});

test("P2 父研究九条长记忆压缩后，子上下文仍是完整有界 JSON 并进入规划", async () => {
  const inputs: string[] = [];
  const s = await setup({ execute: (task, _mode, scenario, at) => executeDemo(task, scenario, at), model: async payload => { inputs.push(String(payload.input)); return { raw: planOutput(), usage: actualUsage }; } }, liveConfig);
  try {
    await s.req("session?mode=demo", { mode: "live" });
    for (let i = 0; i < 9; i++) assert.equal((await s.req("memory?mode=live", { text: `记忆${i}:` + "约".repeat(1982), kind: "research", confirmed: true })).response.status, 201);
    const created = await s.req("runs?mode=live", { goal: "长记忆父研究", symbols: ["600519.SH"], requestId: crypto.randomUUID() });
    let parent = created.data; parent = (await liveAct(s, parent, "advance")).data; parent = (await liveAct(s, parent, "approve", { approved: true })).data; parent = (await liveAct(s, parent, "advance")).data;
    assert.ok(parent.run.contextSummary.length > 18000);
    let child = (await s.req("runs?mode=live", { goal: "延续长记忆研究", symbols: ["600519.SH"], parentId: parent.run.id, requestId: crypto.randomUUID() })).data;
    assert.ok(child.run.contextSummary.length <= 6000);
    const context = JSON.parse(child.run.contextSummary); assert.equal(context.parentId, parent.run.id); assert.equal(context.status, parent.run.status); assert.ok(context.summary.length > 0); assert.ok(parent.run.contextSummary.startsWith(context.summary));
    child = (await liveAct(s, child, "advance")).data; assert.equal(child.planning, false);
    assert.equal(JSON.parse(inputs[1]).parentResearch.summary, context.summary);
  } finally { s.sqlite.close(); }
});

test("P2 父摘要 Unicode/控制字符转义后仍不超过6000且不拆分字符", async () => {
  const s = await setup();
  try {
    const parent = await s.create(); const owner = JSON.parse(Buffer.from(s.cookie().split("=", 2)[1].split(".")[0], "base64url").toString()).ownerId;
    const record = (await s.repo.get(parent.run.id, owner, "demo"))!;
    record.run.contextSummary = "🙂\u0000\"\\\n".repeat(5000);
    const { addEvent } = await import("../lib/buddy/harness.ts"); record.run = addEvent(record.run, "context_saved", "测试摘要", new Date().toISOString()); assert.equal(await s.repo.save(record, 0), true);
    const child = (await s.req("runs?mode=demo", { goal: "转义摘要子研究", symbols, parentId: parent.run.id, requestId: crypto.randomUUID() })).data;
    assert.ok(child.run.contextSummary.length <= 6000); const context = JSON.parse(child.run.contextSummary);
    assert.equal(context.parentId, parent.run.id); assert.equal(context.status, record.run.status); assert.ok(record.run.contextSummary.startsWith(context.summary));
    assert.equal([...context.summary].join(""), context.summary); assert.ok(!/[\uD800-\uDBFF]$/.test(context.summary));
  } finally { s.sqlite.close(); }
});

test("P2 全部三工具耗尽额度后，模型复核TIMEOUT可恢复且不增加工具或重置用量", async () => {
  let calls = 0;
  const s = await setup({ execute: (task, _mode, scenario, at) => executeDemo(task, scenario, at), model: async () => { calls++; if (calls === 2) throw new ProviderError("TIMEOUT", "temporary review failure", true); return { raw: calls === 1 ? planOutput() : functionCall("write_evidence_review", { summary: "恢复复核完成", claims: [], limitations: [], questions: [] }), usage: actualUsage }; } }, liveConfig);
  try {
    await s.req("session?mode=demo", { mode: "live" });
    let v = (await s.req("runs?mode=live", { goal: "三工具研究", symbols: ["600519.SH"], limits: { maxToolCalls: 3 }, requestId: crypto.randomUUID() })).data;
    v = (await liveAct(s, v, "advance")).data; v = (await liveAct(s, v, "approve", { approved: true })).data;
    for (let i = 0; i < 4; i++) v = (await liveAct(s, v, "advance")).data;
    assert.equal(v.run.status, "paused"); assert.equal(v.run.stopReason, "model_failure"); assert.equal(v.run.metrics.toolCalls, 3); assert.equal(v.run.metrics.modelCalls, 2);
    const metrics = structuredClone(v.run.metrics), limits = structuredClone(v.run.limits), evidence = structuredClone(v.run.evidence);
    const resumed = await liveAct(s, v, "resume"); assert.equal(resumed.response.status, 200); v = resumed.data;
    assert.ok(v.run.metrics.elapsedMs >= metrics.elapsedMs); assert.deepEqual({ ...v.run.metrics, elapsedMs: metrics.elapsedMs }, metrics); assert.deepEqual(v.run.limits, limits); assert.deepEqual(v.run.evidence, evidence); assert.ok(v.run.plan.every(t => t.status === "completed"));
    v = (await liveAct(s, v, "advance")).data; assert.equal(v.run.status, "completed"); assert.equal(v.run.metrics.toolCalls, 3); assert.equal(v.run.metrics.modelCalls, 3); assert.equal(calls, 3);
  } finally { s.sqlite.close(); }
});

test("P2 复核阶段恢复仍拒绝累计模型、费用和原始起点运行时长耗尽", async () => {
  for (const exhausted of ["model", "cost", "runtime"]) {
    const now = Date.now(); let calls = 0;
    const s = await setup({ now: () => now, execute: (task, _mode, scenario, at) => executeDemo(task, scenario, at), model: async () => { calls++; if (calls > 1) throw new ProviderError("TIMEOUT", "temporary review failure", true); return { raw: planOutput(), usage: actualUsage }; } }, liveConfig);
    try {
      await s.req("session?mode=demo", { mode: "live" });
      let v = (await s.req("runs?mode=live", { goal: "复核预算边界", symbols: ["600519.SH"], limits: { maxToolCalls: 3 }, requestId: crypto.randomUUID() })).data;
      v = (await liveAct(s, v, "advance")).data; v = (await liveAct(s, v, "approve", { approved: true })).data;
      for (let i = 0; i < 4; i++) v = (await liveAct(s, v, "advance")).data;
      const owner = JSON.parse(Buffer.from(s.cookie().split("=", 2)[1].split(".")[0], "base64url").toString()).ownerId;
      const record = (await s.repo.get(v.run.id, owner, "live"))!;
      if (exhausted === "model") record.run.metrics.modelCalls = record.run.limits.maxModelCalls;
      if (exhausted === "cost") record.run.metrics.estimatedUsd = record.run.limits.maxEstimatedUsd;
      if (exhausted === "runtime") { record.run.metrics.startedAt = new Date(now - record.run.limits.maxRuntimeMs - 1).toISOString(); record.run.metrics.elapsedMs = 0; }
      const { addEvent } = await import("../lib/buddy/harness.ts"); record.run = addEvent(record.run, "test_budget_boundary", "复核预算边界", new Date(now).toISOString()); assert.equal(await s.repo.save(record, v.run.version), true);
      v = (await s.req(`runs/${v.run.id}?mode=live`)).data; const snapshot = structuredClone(v);
      const denied = await liveAct(s, v, "resume"); assert.equal(denied.response.status, 409); assert.equal((denied.data as unknown as { error: { code: string } }).error.code, "BUDGET_EXHAUSTED");
      const current = (await s.req(`runs/${v.run.id}?mode=live`)).data; assert.deepEqual(current, snapshot); assert.equal(calls, 2);
    } finally { s.sqlite.close(); }
  }
});


test("无需访问码：匿名真实入口、过期恢复及owner隔离", async () => {
 const s=await setup({},liveConfig); try {
 const demoOwner=JSON.parse(Buffer.from(s.cookie().split("=")[1].split(".")[0],"base64url").toString()).ownerId;
 const entered=await s.req("bootstrap?mode=live");assert.equal(entered.response.status,200);assert.equal(entered.data.capabilities.liveAvailable,true);assert.equal(entered.data.session.mode,"live");
 assert.equal(JSON.parse(Buffer.from(s.cookie().split("=")[1].split(".")[0],"base64url").toString()).ownerId,demoOwner);
 const created=await s.req("runs?mode=live",{goal:"盈利质量",symbols:["600519.SH"],requestId:crypto.randomUUID()});assert.equal(created.response.status,201);assert.equal(created.data.run.approved,false);assert.equal(created.data.run.metrics.toolCalls,0);
 const fresh=await s.req("bootstrap?mode=live",undefined,"GET",{Cookie:"buddy_session=expired.invalid"});assert.equal(fresh.response.status,200);assert.equal(fresh.data.session.mode,"live");assert.equal(fresh.data.runs.length,0);
 assert.equal((await s.req("runs/"+created.data.run.id+"?mode=live")).response.status,404);
 }finally{s.sqlite.close()}
});
test("无访问码配置：显式live切换可用，旧字段和非法模式拒绝",async()=>{const s=await setup({},liveConfig);try{assert.equal((await s.req("session?mode=demo",{mode:"live"})).response.status,200);assert.equal((await s.req("session?mode=live",{mode:"demo"})).response.status,200);assert.equal((await s.req("session?mode=demo",{mode:"other"})).response.status,400);assert.equal((await s.req("session?mode=demo",{accessCode:"obsolete"})).response.status,400)}finally{s.sqlite.close()}});
