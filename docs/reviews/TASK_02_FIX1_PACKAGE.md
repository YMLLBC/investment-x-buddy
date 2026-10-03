# Harness fix round 1
BASE e333f66139532a3361fa9047eb2a25916d08ce1a
HEAD c645edf902622d83fe79da4a927d10578076a829
diff --git a/docs/stages/TASK_02_REPORT.md b/docs/stages/TASK_02_REPORT.md
index bd0197f..1979a3a 100644
--- a/docs/stages/TASK_02_REPORT.md
+++ b/docs/stages/TASK_02_REPORT.md
@@ -33,10 +33,32 @@
 2. createRun 的签名没有工具注册表，因此校验新任务形状、参数边界和预算；调用方必须先 validatePlan(plan, tools)，再 createRun。注册 Schema 支持 object/array/string/number/integer/boolean/null、required/properties/enum/additionalProperties 和常用长度/数值边界；未识别 Schema 关键字直接拒绝，默认额外参数禁止。
 3. beginTask 计入一次真实工具调用及一次 attempts；调用方仅在即将实际执行工具时调用。失败停因 transient_failure 可恢复；permanent_failure、retry_limit 不可恢复。
 4. 恢复保留原始 startedAt 和 elapsedMs，暂停时间计入总运行时限；已耗尽时间、工具、模型、费用预算不允许恢复绕过。模型用量记录允许实际发生的超限费用入账后显式暂停，调用方还需在真正发模型请求前检查模型和费用预算。
 5. 完成任务保留 running 状态，只有 validateReport 通过后 completeRun 才完成整个运行。事实采用单一精确 raw 值；计算、转换单位、跨证据结论应标注 inference。字段路径为点分路径，数组索引如 rows.0.value；禁止原型路径。null 只在字段确实存在时有效。
 6. 服务端应在异步调用返回后校验持久化运行版本和任务调用身份，再调用 succeedTask/failTask。现有签名没有调用 ID；同一任务重试期间旧请求返回的区分需在调度层处理。停止/暂停状态结果在内核被拒绝。
 7. 压缩阈值为触发值；显式记忆、目标、约束、全部证据 ID 必须保留，因此大量固定内容时压缩后可能仍超过阈值。原始 raw 永不删改，摘要及工具载荷始终作为不可信数据。报告文本检查为确定性规则，无法替代对任意自然语言含义的人工审查。
 
 ## 安全与存储
 
 未读取或使用凭据；未托管、未修改依赖、未操作 ACL。正式文件均已写入 D 盘项目。普通写入权限问题使用已获授权的 require_escalated 文件写入解决。测试目录初始不存在，创建后写入测试；无本任务 C 盘缓存需要清理。
+
+## 审查修正第 1 轮（2026-10-02）
+
+依据 docs/reviews/TASK_02_REVIEW.md 的三项 P1 和一项 P2，已修正并等待独立复审；此记录不表示审查已通过。原有 25 项测试完整保留，新增 5 项含正向基线的审查回归测试。
+
+- 数字事实文本必须逐个匹配原始值且紧跟 verification.unit 的原文；包括浮点数、科学记数法和数字字符串。原始 raw 与 verification.value 仍须类型和值严格相等。拒绝额外不同数字、EUR/% 等不符单位及额外每股单位；支持 metric.fieldPath 选择 metric.unit，例如 CNY 元。非数字字符串不能为数字事实提供证明；计算结果可作为带引用的 inference。
+- 所有报告文字经统一规范化与校验，覆盖证券代码的将来确定目标价、purchase 等英文交易动词及中文公司名交易指令。历史价格、未来未知等表述为接受基线。
+- 对象键与文本使用同一敏感标签集合，补充通用 token/credential；URL 先解析查询参数并逐字段脱敏，覆盖编码后的参数名，保留 URL 路径及 symbol 等非敏感查询参数。Markdown 与 JSON 都验证无模拟秘密且保留来源、字段路径和 hash。
+- 仅 limits=undefined 表示省略；limits=null/false/0/空字符串/数组拒绝，{} 与合法收紧对象仍接受。
+
+红阶段命令：
+`node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`
+结果：30 项，25 通过、5 失败，退出码 1；失败分别复现无效整体预算、错误单位/数字字符串、数字字符串附加不同数值、常见目标价/交易指令及 token/URL 泄漏。
+
+实施中出现一次正则字符串转义语法错误与一次 TypeScript 类型收窄错误，均修正；不将这些实施错误当作需求红阶段证明。
+
+最终验证命令及结果：
+- `node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`：30/30 通过，0 失败，退出码 0。
+- `node node_modules/typescript/bin/tsc --noEmit --allowImportingTsExtensions --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。
+- `node node_modules/eslint/bin/eslint.js lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。
+
+通过判断：所有新增拒绝断言与精确浮点/数字字符串/CNY 元/推断/历史数据/未知表述接受基线同时通过。仍只验证内核与报告模块，不代表服务器或真实上游完成验证。无类型合同变更，未读取密钥、未修改其他文件、未提交。
diff --git a/lib/buddy/harness.ts b/lib/buddy/harness.ts
index 36de3e8..93e5f70 100644
--- a/lib/buddy/harness.ts
+++ b/lib/buddy/harness.ts
@@ -103,21 +103,21 @@ export function validatePlan(tasks: AgentTask[], tools: ToolDefinition[]): void
     const tool = registered.get(task.tool);
     if (!tool) reject("UNKNOWN_TOOL", "Unknown tool");
     argumentCheck(task.arguments, tool.inputSchema);
   }
 }
 
 export function createRun(input: { id: string; ownerId: string; goal: string; title: string; mode: RunMode; plan: AgentTask[]; now: string; limits?: Partial<RunLimits>; memory?: MemoryEntry[] }): AgentRun {
   text(input.id, "run ID", 100); text(input.ownerId, "owner ID", 200); text(input.goal, "goal", 2000); text(input.title, "title", 200); date(input.now); planShape(input.plan);
   if (!["demo", "live"].includes(input.mode)) reject("INVALID_INPUT", "Invalid mode");
   const limits = { ...DEFAULT_LIMITS };
-  if (input.limits && (!object(input.limits) || Object.keys(input.limits).some(key => !Object.hasOwn(DEFAULT_LIMITS, key)))) reject("INVALID_LIMITS", "Unknown limit");
+  if (input.limits !== undefined && (!object(input.limits) || Object.keys(input.limits).some(key => !Object.hasOwn(DEFAULT_LIMITS, key)))) reject("INVALID_LIMITS", "Unknown limit");
   for (const key of Object.keys(limits) as (keyof RunLimits)[]) {
     const value = input.limits && Object.hasOwn(input.limits, key) ? input.limits[key] : limits[key];
     if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > DEFAULT_LIMITS[key] || (key !== "maxEstimatedUsd" && !Number.isSafeInteger(value))) reject("INVALID_LIMITS", "Limits may only tighten defaults");
     limits[key] = value;
   }
   const memory = input.memory ?? [];
   if (!Array.isArray(memory) || memory.length > 50) reject("INVALID_INPUT", "Invalid memory");
   const memoryIds = new Set<string>();
   for (const entry of memory) {
     text(entry.id, "memory ID", 100); text(entry.text, "memory text", 2000); date(entry.createdAt);
@@ -247,10 +247,11 @@ export function compactContext(run: AgentRun, threshold = 18000): { run: AgentRu
 export function completeRun(run: AgentRun, report: ResearchReport, now: string): AgentRun {
   approved(run);
   if (run.plan.some(task => task.status !== "completed")) reject("INCOMPLETE_PLAN", "All tasks must complete before report");
   let valid: ResearchReport;
   try { valid = validateReport(report, run.evidence); } catch { reject("INVALID_REPORT", "Report failed evidence and safety validation"); }
   const next = elapsed(run, now);
   if (next.metrics.elapsedMs >= next.limits.maxRuntimeMs || next.metrics.estimatedUsd > next.limits.maxEstimatedUsd || next.metrics.modelCalls > next.limits.maxModelCalls) return pause(next, "report_budget_exhausted", now);
   next.report = valid; next.status = "completed";
   return addEvent(next, "completed", "Research report validated and completed", now);
 }
+
diff --git a/lib/buddy/report.ts b/lib/buddy/report.ts
index 3209222..07091c4 100644
--- a/lib/buddy/report.ts
+++ b/lib/buddy/report.ts
@@ -1,22 +1,37 @@
 import type { AgentRun, Evidence, ResearchReport } from "./types.ts";
 
 const forbiddenKeys = /^(?:__proto__|prototype|constructor)$/;
-const sensitiveKey = /authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|session|ownerid|secret|password|credential|^token$/i;
+const sensitiveLabel = "authorization|api[-_]?key|(?:access|refresh|session)[-_]?token|token|session|owner[-_]?id|secret|password|credentials?";
+const sensitiveKey = new RegExp(sensitiveLabel, "i");
+const sensitiveText = new RegExp("\\b(" + sensitiveLabel + ")[\"']?\\s*[:=]\\s*(?:\"[^\"\\r\\n]*\"|'[^'\\r\\n]*'|[^\\s,;\"'&}]+)", "gi");
+function redactUrls(text: string): string {
+  return text.replace(/https?:\/\/[^\s<>"']+/gi, source => {
+    try {
+      const url = new URL(source);
+      let changed = false;
+      for (const key of [...url.searchParams.keys()]) {
+        if (sensitiveKey.test(key)) { url.searchParams.set(key, "[REDACTED]"); changed = true; }
+      }
+      if (url.username || url.password) { url.username = ""; url.password = ""; changed = true; }
+      return changed ? url.toString() : source;
+    } catch { return source; }
+  });
+}
 const reasoningKey = /reasoning|chain.?of.?thought|scratchpad|^analysis$|^thoughts$/i;
 
 /** Deterministic redaction for exports and diagnostic events; no credentials are needed by this module. */
 export function redactText(text: string): string {
-  return text
+  return redactUrls(text)
     .replace(/\bAuthorization["']?\s*[:=]\s*["']?[^\r\n,;"'}]+/gi, "Authorization: [REDACTED]")
     .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
-    .replace(/\b(?:api[-_]?key|access[-_]?token|refresh[-_]?token|session(?:[-_]?token)?|owner[-_]?id|password|secret)["']?\s*[:=]\s*["']?[^\s,;"'}]+/gi, "[REDACTED]")
+    .replace(sensitiveText, "$1=[REDACTED]")
     .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
     .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
     .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
 }
 
 export function redactValue(value: unknown, depth = 0): unknown {
   if (depth > 30) return "[DEPTH_LIMIT]";
   if (typeof value === "string") return redactText(value);
   if (Array.isArray(value)) return value.map(item => redactValue(item, depth + 1));
   if (value && typeof value === "object") {
@@ -62,37 +77,59 @@ function rawAt(raw: unknown, path: string): unknown {
     if (!current || typeof current !== "object" || !Object.hasOwn(current, part)) invalid("Raw path does not exist");
     current = (current as Record<string, unknown>)[part];
   }
   if (current === undefined) invalid("Raw path is undefined");
   return current;
 }
 
 const disallowed = /(?:\b(?:guaranteed?|risk[- ]?free|certain|assured)\b.{0,60}\b(?:return|profit|gain|price)\b|\b(?:price|stock|share)\b.{0,80}\b(?:will|must|certainly)\b.{0,50}\b(?:reach|rise|fall|hit|increase|decrease|double)\b|\b(?:buy|sell)\s+(?!and\b|or\b)[A-Z][A-Z0-9.:-]{0,15}\b|\b(?:buy|sell)\b.{0,40}\b(?:now|immediately|today)\b|(?:立即|现在|建议|应当|应该|务必|马上).{0,30}(?:买入|卖出|购买|抛售)|(?:买入|卖出).{0,20}(?:股票|股份|证券)|(?:股价|价格|收益|回报).{0,40}(?:必定|一定|保证|必然|将会|肯定)|(?:保证|保本|稳赚|必赚).{0,30}(?:收益|回报|盈利|上涨)?)/i;
 
 function validateText(text: string): void {
-  if (disallowed.test(text) || /\bwill\b.{0,60}(?:[$€£]\s*\d|\bbe\s+\d)|\b(?:buy|sell)\s+(?:shares?|stocks?|securities)\b|(?:买入|卖出|购买|抛售)\s+[A-Z][A-Z0-9.:-]*|(?:未来|明天|下周|下月).{0,30}(?:价格|股价).{0,20}\d/i.test(text)) invalid("Forecast, return guarantee or trading instruction");
+  const normalized = text.normalize("NFKC").replace(/\s+/g, " ");
+  const futureTarget = /\b(?:will|must|certainly|definitely)\b.{0,50}\b(?:reach|hit|rise|fall|increase|decrease|double|trade|be)\b.{0,30}(?:[$€£¥]?\s*\d)/i;
+  const tradingAction = /(?:^|[.!?;。！？；]\s*)(?:please\s+|you\s+(?:should|must)\s+|(?:we\s+)?(?:recommend|advise)\s+(?:you\s+to\s+)?)?(?:buy|sell|purchase|short|liquidate)\b.{0,80}/i;
+  const directChinese = /(?:^|[。！？；;.!?]\s*)(?:(?:请|立即|现在|建议|应当|应该|务必|马上)\s*)*(?:买入|卖出|购买|抛售|做空|减仓|加仓)[^。！？；;.!?]{1,60}/;
+  if (disallowed.test(normalized) || futureTarget.test(normalized) || tradingAction.test(normalized) || directChinese.test(normalized) || /\bwill\b.{0,60}(?:[$€£]\s*\d|\bbe\s+\d)|(?:未来|明天|下周|下月).{0,30}(?:价格|股价).{0,20}\d/i.test(normalized)) invalid("Forecast, return guarantee or trading instruction");
 }
 
-/** Numeric facts use a single exact raw value; derived calculations must be marked inference. */
-function validateFactText(text: string, value: number | string | null, e: Evidence): void {
-  let factual = text;
-  for (const token of [e.symbol, e.scope, e.asOf, e.retrievedAt]) {
-    if (token) factual = factual.split(token).join(" ");
+/** Numeric facts require every stated number and its literal unit to match the exact source. */
+function validateFactText(text: string, value: number | string | null, e: Evidence, unit: string): void {
+  let factual = text.normalize("NFKC");
+  for (const token of [e.symbol, e.scope, e.asOf, e.retrievedAt, ...(e.metrics?.map(metric => metric.period) ?? [])]) {
+    if (token) factual = factual.split(token.normalize("NFKC")).join(" ");
   }
   factual = factual.replace(/\b\d{4}-\d{2}-\d{2}(?:T[^\s]+)?\b/g, " ");
-  const numbers = [...factual.matchAll(/(?<![A-Za-z0-9])[-+]?\d+(?:,\d{3})*(?:\.\d+)?(?:[eE][-+]?\d+)?(?![A-Za-z0-9])/g)].map(match => Number(match[0].replaceAll(",", "")));
-  if (typeof value === "number") {
-    if (!Number.isFinite(value) || numbers.length === 0 || numbers.some(number => number !== value)) invalid("Numeric claim contradicts verified raw value");
+  const numericLiteral = /^[-+]?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?$/;
+  const numericValue = typeof value === "number" ? value : typeof value === "string" && numericLiteral.test(value.trim()) ? Number(value.trim().replaceAll(",", "")) : undefined;
+  const matches = [...factual.matchAll(/(?<![\w.])[-+]?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?(?![\w.])/g)];
+  if (numericValue !== undefined) {
+    if (!Number.isFinite(numericValue) || !matches.length) invalid("Numeric fact must state the verified value");
+    const literalUnit = unit.normalize("NFKC");
+    let remainder = factual;
+    for (const match of matches.reverse()) {
+      if (Number(match[0].replaceAll(",", "")) !== numericValue) invalid("Numeric claim contradicts verified raw value");
+      const start = match.index!;
+      const prefix = factual.slice(0, start);
+      const afterNumber = factual.slice(start + match[0].length);
+      const spacing = afterNumber.match(/^\s*/)?.[0].length ?? 0;
+      const afterSpace = afterNumber.slice(spacing);
+      if (!afterSpace.startsWith(literalUnit)) invalid("Numeric fact must use the exact verified unit");
+      const suffix = afterSpace.slice(literalUnit.length);
+      if (/^[A-Za-z%％/]/.test(suffix) || /^[ \t]*(?:per\b|each\b|每|\/)/i.test(suffix) || /[$€£¥￥]\s*$/.test(prefix)) invalid("Numeric fact has an additional or conflicting unit");
+      remainder = remainder.slice(0, start) + " " + remainder.slice(start + match[0].length + spacing + literalUnit.length);
+    }
+    if (/\b(?:USD|EUR|CNY|RMB|GBP|JPY|HKD|CAD|AUD|CHF|INR|KRW|shares?|percent|dollars?|yuan)\b|[%％$€£¥￥]|(?:亿元|万元|人民币|美元|欧元|港元|日元)|(?:每股|每份)/i.test(remainder)) invalid("Numeric fact has an unsupported additional unit");
   } else if (value === null) {
-    if (numbers.length) invalid("Null raw value cannot support numeric fact");
+    if (matches.length) invalid("Null raw value cannot support numeric fact");
   } else {
-    if (!text.includes(value)) invalid("String fact must include verified raw value");
+    if (typeof value !== "string" || !text.includes(value)) invalid("String fact must include verified raw value");
+    if (matches.length) invalid("Non-numeric raw strings cannot support numeric facts");
   }
 }
 
 export function validateReport(report: ResearchReport, evidence: Evidence[]): ResearchReport {
   if (!report || typeof report !== "object") invalid("Missing report");
   string(report.title, "title", 500); string(report.summary, "summary", 6000); timestamp(report.generatedAt, "generatedAt");
   if (!Array.isArray(report.claims) || report.claims.length > 100 || !Array.isArray(report.limitations) || report.limitations.length > 30 || !Array.isArray(report.questions) || report.questions.length > 30) invalid("Invalid report arrays");
   for (const text of [...report.limitations, ...report.questions]) { string(text, "report item", 2000); validateText(text); }
   validateText(report.title); validateText(report.summary);
   if (!Array.isArray(evidence) || evidence.length > 500) invalid("Invalid evidence list");
@@ -111,21 +148,21 @@ export function validateReport(report: ResearchReport, evidence: Evidence[]): Re
       for (const id of claim.evidenceIds) if (sources.get(id)!.quality !== "valid" || !sources.get(id)!.asOf) invalid("Fact requires valid dated evidence");
       const v = claim.verification;
       if (!v || typeof v !== "object" || !claim.evidenceIds.includes(v.evidenceId)) invalid("Fact needs cited verification");
       const e = sources.get(v.evidenceId)!;
       if (typeof v.value !== "number" && typeof v.value !== "string" && v.value !== null) invalid("Invalid verification value");
       if (typeof v.value === "string") string(v.value, "verification value", 2000, true);
       string(v.unit, "verification unit", 100);
       const metric = e.metrics?.find(item => item.fieldPath === v.fieldPath);
       if (v.unit !== (metric?.unit ?? e.unit)) invalid("Unit mismatch");
       if (!Object.is(rawAt(e.raw, v.fieldPath), v.value)) invalid("Raw value mismatch");
-      validateFactText(claim.text, v.value, e);
+      validateFactText(claim.text, v.value, e, v.unit);
     }
   }
   return structuredClone(report);
 }
 
 function escapeMarkdown(value: unknown): string {
   return redactText(String(value)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/([\\\x60*_{}\[\]#|])/g, "\\$1").replace(/\r?\n/g, " ");
 }
 
 export function exportReport(run: AgentRun, format: "markdown" | "json"): string {
@@ -138,10 +175,11 @@ export function exportReport(run: AgentRun, format: "markdown" | "json"): string
   if (format === "json") return JSON.stringify(data, null, 2);
   const lines = ["# " + escapeMarkdown(data.report.title), "", escapeMarkdown(data.report.summary), "", "Generated: " + escapeMarkdown(data.report.generatedAt), ""];
   for (const claim of data.report.claims) {
     lines.push("- [" + claim.kind + "] " + escapeMarkdown(claim.text) + " | citations: " + claim.evidenceIds.map(escapeMarkdown).join(", "));
     if (claim.verification) { const v = claim.verification; lines.push("  Verification: " + escapeMarkdown(v.evidenceId) + " / " + escapeMarkdown(v.fieldPath) + " = " + escapeMarkdown(v.value) + " " + escapeMarkdown(v.unit)); }
   }
   lines.push("", "## Caveats", ...data.report.limitations.map(item => "- " + escapeMarkdown(item)), "", "## Open questions", ...data.report.questions.map(item => "- " + escapeMarkdown(item)), "", "## Sources");
   for (const e of data.evidence) lines.push("- " + escapeMarkdown(e.id) + ": " + escapeMarkdown(e.provider) + " | source: " + escapeMarkdown(e.sourceUrl) + " | retrieved: " + escapeMarkdown(e.retrievedAt) + " | asOf: " + escapeMarkdown(e.asOf ?? "unknown") + " | unit: " + escapeMarkdown(e.unit) + " | scope: " + escapeMarkdown(e.scope) + " | quality: " + e.quality + " | hash: " + escapeMarkdown(e.hash));
   return lines.join("\n");
 }
+
diff --git a/tests/harness.test.ts b/tests/harness.test.ts
index 874514d..64f4e89 100644
--- a/tests/harness.test.ts
+++ b/tests/harness.test.ts
@@ -80,10 +80,16 @@ test("completion requires valid report and all tasks complete", () => {
 });
 
 test("null and unknown budgets fail closed", () => {
  assert.throws(() => run([task()], { maxRuntimeMs: null }), HarnessError);
  assert.throws(() => run([task()], { unknownBudget: 1 }), HarnessError);
 });
 test("nontransient failed runs cannot resume", () => {
  const r = { ...active(), status: "failed" as const, stopReason: "unexpected_permanent_error" };
  assert.throws(() => resumeRun(r, now), HarnessError);
 });
+
+
+test("review R1 rejects whole invalid limits but allows omitted empty and tightened objects", () => {
+ assert.deepEqual(run().limits, DEFAULT_LIMITS); assert.deepEqual(run([task()], {}).limits, DEFAULT_LIMITS); assert.equal(run([task()], { maxToolCalls: 2 }).limits.maxToolCalls, 2);
+ for (const limits of [null, false, 0, "", []]) assert.throws(() => run([task()], limits as never), error => error instanceof HarnessError && error.code === "INVALID_LIMITS");
+});
diff --git a/tests/report.test.ts b/tests/report.test.ts
index 0d5d60b..e547e50 100644
--- a/tests/report.test.ts
+++ b/tests/report.test.ts
@@ -40,10 +40,47 @@ test("exports redact embedded JSON credentials and omit unrecognized reasoning p
  const r = createRun({ id: "r", ownerId: "o", goal: "Research", title: "R", mode: "demo", plan: [{ id: "t", title: "Read", tool: "quote", arguments: {}, status: "pending", attempts: 0 }], now });
  r.report = Object.assign(report(), { reasoning_content: "HIDDEN_REPORT", unexpectedModelPayload: "HIDDEN_PAYLOAD" });
  r.evidence = [{ ...e, raw: { ...e.raw as object, note: '{"apiKey":"EMBEDDED_SECRET"} ownerId=OWNER_TEXT Authorization: Basic BASIC_SECRET', reasoning_content: "HIDDEN_RAW" } }];
  const result = exportReport(r, "json");
  assert.doesNotMatch(result, /EMBEDDED_SECRET|OWNER_TEXT|BASIC_SECRET|HIDDEN_REPORT|HIDDEN_PAYLOAD|HIDDEN_RAW/);
 });
 test("future target prices and Chinese direct trades are rejected", () => {
  validateReport(report(), [e]);
  for (const summary of ["AAPL will be $500 tomorrow", "Buy shares of AAPL", "卖出 AAPL", "未来价格为 500 美元"]) { const r = report(); r.summary = summary; assert.throws(() => validateReport(r, [e])); }
 });
+
+
+test("review R1 numeric facts bind text units and reject contradictory numeric strings", () => {
+ validateReport(report(), [e]);
+ for (const text of ["Price is 100 EUR", "Price is 100%", "Price is 100 USD and 100 EUR", "Price is $100 USD", "Price is 100 USD per share"]) { const r = report(); r.claims[0].text = text; assert.throws(() => validateReport(r, [e]), text); }
+ const stringEvidence = { ...e, raw: { quote: { price: "100" } } }, r = report();
+ r.claims[0].verification!.value = "100"; validateReport(r, [stringEvidence]);
+ r.claims[0].text = "Price is 200 USD (source 100)"; assert.throws(() => validateReport(r, [stringEvidence]));
+});
+test("review R1 accepts precise float and literal metric units while rejecting extra values", () => {
+ const cases = [{ value: 0.30000000000000004, unit: "CNY 元" }, { value: "12.3400", unit: "CNY 元" }, { value: "1e-7", unit: "%" }];
+ for (const { value, unit } of cases) {
+  const metricEvidence = { ...e, unit: "mixed", raw: { value }, metrics: [{ key: "metric", label: "Metric", value: Number(value), unit, fieldPath: "value" }] };
+  const r = report(); r.claims[0].text = "Metric: " + value + " " + unit; r.claims[0].verification = { evidenceId: "e1", fieldPath: "value", value, unit };
+  validateReport(r, [metricEvidence]); r.claims[0].text += " and 200 " + unit; assert.throws(() => validateReport(r, [metricEvidence]));
+ }
+ const r = report(); r.claims[0] = { id: "derived", kind: "inference", text: "Calculated estimate is 200 EUR", evidenceIds: ["e1"] }; validateReport(r, [e]);
+});
+test("review R1 rejects common deterministic forecasts and trade imperatives across fields", () => {
+ const ordinary = report(); ordinary.summary = "AAPL reached 100 USD yesterday; future price is unknown. 不建议交易，未来价格未知。"; validateReport(ordinary, [e]);
+ for (const text of ["AAPL will reach 500 tomorrow", "买入苹果", "Purchase AAPL immediately"]) {
+  for (const field of ["title", "summary", "limitations", "questions", "claim"] as const) {
+   const r = report(); if (field === "limitations" || field === "questions") r[field] = [text]; else if (field === "claim") r.claims[0] = { id: "i", kind: "inference", text, evidenceIds: ["e1"] }; else r[field] = text;
+   assert.throws(() => validateReport(r, [e]), field + ": " + text);
+  }
+ }
+});
+test("review R1 redacts token credentials and URL queries in both exports retaining provenance", () => {
+ const r = createRun({ id: "r", ownerId: "o", goal: "Research", title: "R", mode: "demo", plan: [{ id: "t", title: "Read", tool: "quote", arguments: {}, status: "pending", attempts: 0 }], now });
+ r.report = report(); r.report.summary = "Observed data; token=TOKEN_SECRET credential:CREDENTIAL_SECRET api_key = APIKEY_SECRET Authorization=Bearer AUTH_SECRET";
+ r.evidence = [{ ...e, sourceUrl: "https://example.com/data?symbol=AAPL&token=QUERY_SECRET&credential=CRED_QUERY&api_key=KEY_QUERY", raw: { ...e.raw as object, note: "token=RAW_TOKEN credential=RAW_CREDENTIAL", source: "https://example.com/data?symbol=AAPL&%74oken=ENCODED_SECRET&access_token=ACCESS_SECRET" } }];
+ for (const format of ["json", "markdown"] as const) {
+  const result = exportReport(r, format);
+  assert.doesNotMatch(result, /TOKEN_SECRET|CREDENTIAL_SECRET|APIKEY_SECRET|AUTH_SECRET|QUERY_SECRET|CRED_QUERY|KEY_QUERY|RAW_TOKEN|RAW_CREDENTIAL|ENCODED_SECRET|ACCESS_SECRET/);
+  assert.match(result, /example.com\/data/); assert.match(result, /symbol=AAPL/); assert.match(result, /quote.price/); assert.match(result, /abc/);
+ }
+});
