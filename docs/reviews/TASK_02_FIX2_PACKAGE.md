# Harness fix round 2
BASE c645edf902622d83fe79da4a927d10578076a829
HEAD 964c5025fa62dd5985e24e5a37dd8736a788dca9
diff --git a/docs/stages/TASK_02_REPORT.md b/docs/stages/TASK_02_REPORT.md
index 1979a3a..430ea08 100644
--- a/docs/stages/TASK_02_REPORT.md
+++ b/docs/stages/TASK_02_REPORT.md
@@ -55,10 +55,28 @@
 结果：30 项，25 通过、5 失败，退出码 1；失败分别复现无效整体预算、错误单位/数字字符串、数字字符串附加不同数值、常见目标价/交易指令及 token/URL 泄漏。
 
 实施中出现一次正则字符串转义语法错误与一次 TypeScript 类型收窄错误，均修正；不将这些实施错误当作需求红阶段证明。
 
 最终验证命令及结果：
 - `node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`：30/30 通过，0 失败，退出码 0。
 - `node node_modules/typescript/bin/tsc --noEmit --allowImportingTsExtensions --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。
 - `node node_modules/eslint/bin/eslint.js lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。
 
 通过判断：所有新增拒绝断言与精确浮点/数字字符串/CNY 元/推断/历史数据/未知表述接受基线同时通过。仍只验证内核与报告模块，不代表服务器或真实上游完成验证。无类型合同变更，未读取密钥、未修改其他文件、未提交。
+
+## 审查修正第 2 轮（2026-10-02）
+
+依据 docs/reviews/TASK_02_REREVIEW_1.md 的剩余 P1 与新增 P2，已修正并等待复审。原 30 项测试完整保留，新增 3 项回归测试。
+
+- P1：数字识别不再以字母右边界排除数字；仅在解析前排除可信证券代码/期间元数据，其他剩余数字全部核验。因此 200USD、200EUR 以及错误贴单位的数字与正确来源数字混用均被拒绝；JSON 和 Markdown 导出也明确验证拒绝错误 fact。正确 100USD、100 USD、1e-7CNY 元及可信 600519.SH/2025Q4 接受；原精确浮点、数字字符串等基线保留。
+- P2：交易动作检测逐句检查，以金融名词主体加历史/陈述系动词区分说明与指令。Short interest is...、Purchase price was...、Short positions were...、Purchase costs are... 在所有报告文字位置接受；Short AAPL immediately、Purchase AAPL immediately、You should purchase AAPL、Please short shares of AAPL 仍拒绝。未移除既有预测或交易规则。
+
+红阶段：
+`node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`
+结果：33 项，30 通过、3 失败，退出码 1；分别确认贴单位数字绕过、正确紧凑格式误拒绝、历史金融名词误拒绝。
+
+最终绿阶段：
+- `node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`：33/33 通过，0 失败，退出码 0。
+- `node node_modules/typescript/bin/tsc --noEmit --allowImportingTsExtensions --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。
+- `node node_modules/eslint/bin/eslint.js lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。
+
+判断标准：原 30 项全部通过，紧凑错误数字/单位及错误导出拒绝，合法紧凑精确数值、历史陈述接受，原预测与交易指令仍拒绝。数字出现在未声明的代码/期间等文字中时会按剩余数字处理；调用方应使用证据的明确 scope/symbol/metric.period 元数据。仅修改 report.ts、report.test.ts 并追加本报告，无其他模块或类型变更，未读取密钥、未提交。
diff --git a/lib/buddy/report.ts b/lib/buddy/report.ts
index 07091c4..45b6e23 100644
--- a/lib/buddy/report.ts
+++ b/lib/buddy/report.ts
@@ -79,35 +79,39 @@ function rawAt(raw: unknown, path: string): unknown {
   }
   if (current === undefined) invalid("Raw path is undefined");
   return current;
 }
 
 const disallowed = /(?:\b(?:guaranteed?|risk[- ]?free|certain|assured)\b.{0,60}\b(?:return|profit|gain|price)\b|\b(?:price|stock|share)\b.{0,80}\b(?:will|must|certainly)\b.{0,50}\b(?:reach|rise|fall|hit|increase|decrease|double)\b|\b(?:buy|sell)\s+(?!and\b|or\b)[A-Z][A-Z0-9.:-]{0,15}\b|\b(?:buy|sell)\b.{0,40}\b(?:now|immediately|today)\b|(?:立即|现在|建议|应当|应该|务必|马上).{0,30}(?:买入|卖出|购买|抛售)|(?:买入|卖出).{0,20}(?:股票|股份|证券)|(?:股价|价格|收益|回报).{0,40}(?:必定|一定|保证|必然|将会|肯定)|(?:保证|保本|稳赚|必赚).{0,30}(?:收益|回报|盈利|上涨)?)/i;
 
 function validateText(text: string): void {
   const normalized = text.normalize("NFKC").replace(/\s+/g, " ");
   const futureTarget = /\b(?:will|must|certainly|definitely)\b.{0,50}\b(?:reach|hit|rise|fall|increase|decrease|double|trade|be)\b.{0,30}(?:[$€£¥]?\s*\d)/i;
-  const tradingAction = /(?:^|[.!?;。！？；]\s*)(?:please\s+|you\s+(?:should|must)\s+|(?:we\s+)?(?:recommend|advise)\s+(?:you\s+to\s+)?)?(?:buy|sell|purchase|short|liquidate)\b.{0,80}/i;
+  const tradingAction = /(?:^|[.!?;。！？；]\s*)(?:please\s+|you\s+(?:should|must)\s+|(?:we\s+)?(?:recommend|advise)\s+(?:you\s+to\s+)?)?(?:buy|sell|purchase|short|liquidate)\b[^.!?;。！？；]{0,80}/gi;
+  // Nominal financial subjects followed by a reporting copula describe data rather than directing a trade.
+  const financialSubject = /(?:^|[.!?;。！？；]\s*)(?:short\s+(?:interest|positions?|exposure|volume)|purchase\s+(?:price|costs?|orders?))\b(?:\s+[A-Za-z]+){0,3}\s+(?:is|are|was|were|has|have|had)\b/i;
+  const unsafeTradingAction = [...normalized.matchAll(tradingAction)].some(match => !financialSubject.test(match[0]));
   const directChinese = /(?:^|[。！？；;.!?]\s*)(?:(?:请|立即|现在|建议|应当|应该|务必|马上)\s*)*(?:买入|卖出|购买|抛售|做空|减仓|加仓)[^。！？；;.!?]{1,60}/;
-  if (disallowed.test(normalized) || futureTarget.test(normalized) || tradingAction.test(normalized) || directChinese.test(normalized) || /\bwill\b.{0,60}(?:[$€£]\s*\d|\bbe\s+\d)|(?:未来|明天|下周|下月).{0,30}(?:价格|股价).{0,20}\d/i.test(normalized)) invalid("Forecast, return guarantee or trading instruction");
+  if (disallowed.test(normalized) || futureTarget.test(normalized) || unsafeTradingAction || directChinese.test(normalized) || /\bwill\b.{0,60}(?:[$€£]\s*\d|\bbe\s+\d)|(?:未来|明天|下周|下月).{0,30}(?:价格|股价).{0,20}\d/i.test(normalized)) invalid("Forecast, return guarantee or trading instruction");
 }
 
 /** Numeric facts require every stated number and its literal unit to match the exact source. */
 function validateFactText(text: string, value: number | string | null, e: Evidence, unit: string): void {
   let factual = text.normalize("NFKC");
   for (const token of [e.symbol, e.scope, e.asOf, e.retrievedAt, ...(e.metrics?.map(metric => metric.period) ?? [])]) {
     if (token) factual = factual.split(token.normalize("NFKC")).join(" ");
   }
   factual = factual.replace(/\b\d{4}-\d{2}-\d{2}(?:T[^\s]+)?\b/g, " ");
   const numericLiteral = /^[-+]?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?$/;
   const numericValue = typeof value === "number" ? value : typeof value === "string" && numericLiteral.test(value.trim()) ? Number(value.trim().replaceAll(",", "")) : undefined;
-  const matches = [...factual.matchAll(/(?<![\w.])[-+]?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?(?![\w.])/g)];
+  // Remove only trusted symbol/period metadata above; every remaining numeric token must be checked, including 200USD.
+  const matches = [...factual.matchAll(/[-+]?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?/g)];
   if (numericValue !== undefined) {
     if (!Number.isFinite(numericValue) || !matches.length) invalid("Numeric fact must state the verified value");
     const literalUnit = unit.normalize("NFKC");
     let remainder = factual;
     for (const match of matches.reverse()) {
       if (Number(match[0].replaceAll(",", "")) !== numericValue) invalid("Numeric claim contradicts verified raw value");
       const start = match.index!;
       const prefix = factual.slice(0, start);
       const afterNumber = factual.slice(start + match[0].length);
       const spacing = afterNumber.match(/^\s*/)?.[0].length ?? 0;
@@ -176,10 +180,11 @@ export function exportReport(run: AgentRun, format: "markdown" | "json"): string
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
diff --git a/tests/report.test.ts b/tests/report.test.ts
index e547e50..d4f3c04 100644
--- a/tests/report.test.ts
+++ b/tests/report.test.ts
@@ -77,10 +77,34 @@ test("review R1 rejects common deterministic forecasts and trade imperatives acr
 test("review R1 redacts token credentials and URL queries in both exports retaining provenance", () => {
  const r = createRun({ id: "r", ownerId: "o", goal: "Research", title: "R", mode: "demo", plan: [{ id: "t", title: "Read", tool: "quote", arguments: {}, status: "pending", attempts: 0 }], now });
  r.report = report(); r.report.summary = "Observed data; token=TOKEN_SECRET credential:CREDENTIAL_SECRET api_key = APIKEY_SECRET Authorization=Bearer AUTH_SECRET";
  r.evidence = [{ ...e, sourceUrl: "https://example.com/data?symbol=AAPL&token=QUERY_SECRET&credential=CRED_QUERY&api_key=KEY_QUERY", raw: { ...e.raw as object, note: "token=RAW_TOKEN credential=RAW_CREDENTIAL", source: "https://example.com/data?symbol=AAPL&%74oken=ENCODED_SECRET&access_token=ACCESS_SECRET" } }];
  for (const format of ["json", "markdown"] as const) {
   const result = exportReport(r, format);
   assert.doesNotMatch(result, /TOKEN_SECRET|CREDENTIAL_SECRET|APIKEY_SECRET|AUTH_SECRET|QUERY_SECRET|CRED_QUERY|KEY_QUERY|RAW_TOKEN|RAW_CREDENTIAL|ENCODED_SECRET|ACCESS_SECRET/);
   assert.match(result, /example.com\/data/); assert.match(result, /symbol=AAPL/); assert.match(result, /quote.price/); assert.match(result, /abc/);
  }
 });
+
+
+test("review R2 rejects contradictory numbers attached to units including exports", () => {
+ for (const text of ["Price is 200USD (source 100 USD)", "Price is 100 USD and 200EUR", "Price is 100USD and 200EUR", "Price is 100EUR", "Price is 100USD and 100EUR"]) {
+  const r = report(); r.claims[0].text = text; assert.throws(() => validateReport(r, [e]), text);
+  const run = createRun({ id: "r", ownerId: "o", goal: "Research", title: "R", mode: "demo", plan: [{ id: "t", title: "Read", tool: "quote", arguments: {}, status: "pending", attempts: 0 }], now }); run.report = r; run.evidence = [e];
+  for (const format of ["json", "markdown"] as const) assert.throws(() => exportReport(run, format), text);
+ }
+});
+test("review R2 accepts exact compact numeric units and trusted scope or period", () => {
+ for (const text of ["Price is 100USD", "Price is 100 USD"]) { const r = report(); r.claims[0].text = text; validateReport(r, [e]); }
+ const compact = { ...e, scope: "600519.SH", symbol: "600519.SH", raw: { value: "1e-7" }, metrics: [{ key: "v", label: "Value", value: 1e-7, unit: "CNY 元", fieldPath: "value", period: "2025Q4" }] };
+ const r = report(); r.claims[0].text = "600519.SH 2025Q4 value: 1e-7CNY 元"; r.claims[0].verification = { evidenceId: "e1", fieldPath: "value", value: "1e-7", unit: "CNY 元" }; validateReport(r, [compact]);
+ r.claims[0].text += " and 2e-7CNY 元"; assert.throws(() => validateReport(r, [compact]));
+});
+test("review R2 accepts financial noun phrases and historical prose while rejecting commands", () => {
+ for (const text of ["Short interest is disclosed in historical data.", "Purchase price was 100 USD yesterday.", "Short positions were disclosed in the annual report.", "Purchase costs are recorded in historical data."]) {
+  for (const field of ["title", "summary", "limitations", "questions", "claim"] as const) {
+   const r = report(); if (field === "limitations" || field === "questions") r[field] = [text]; else if (field === "claim") r.claims[0] = { id: "i", kind: "inference", text, evidenceIds: ["e1"] }; else r[field] = text;
+   assert.doesNotThrow(() => validateReport(r, [e]), text);
+  }
+ }
+ for (const text of ["Short AAPL immediately.", "Purchase AAPL immediately.", "You should purchase AAPL.", "Please short shares of AAPL."]) { const r = report(); r.summary = text; assert.throws(() => validateReport(r, [e]), text); }
+});
