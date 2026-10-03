# Harness fix round 3
BASE 964c5025fa62dd5985e24e5a37dd8736a788dca9
HEAD f1886f4a3efdb677a7548120fc484004ca04dca8
diff --git a/docs/stages/TASK_02_REPORT.md b/docs/stages/TASK_02_REPORT.md
index 430ea08..5a6f161 100644
--- a/docs/stages/TASK_02_REPORT.md
+++ b/docs/stages/TASK_02_REPORT.md
@@ -73,10 +73,29 @@
 红阶段：
 `node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`
 结果：33 项，30 通过、3 失败，退出码 1；分别确认贴单位数字绕过、正确紧凑格式误拒绝、历史金融名词误拒绝。
 
 最终绿阶段：
 - `node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`：33/33 通过，0 失败，退出码 0。
 - `node node_modules/typescript/bin/tsc --noEmit --allowImportingTsExtensions --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。
 - `node node_modules/eslint/bin/eslint.js lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。
 
 判断标准：原 30 项全部通过，紧凑错误数字/单位及错误导出拒绝，合法紧凑精确数值、历史陈述接受，原预测与交易指令仍拒绝。数字出现在未声明的代码/期间等文字中时会按剩余数字处理；调用方应使用证据的明确 scope/symbol/metric.period 元数据。仅修改 report.ts、report.test.ts 并追加本报告，无其他模块或类型变更，未读取密钥、未提交。
+
+## 审查修正第 3 轮（2026-10-02）
+
+依据 docs/reviews/TASK_02_REREVIEW_2.md 的历史名词豁免后续交易动作 P1，已修正，等待独立复审。原 33 项测试保留，新增 2 项。
+
+修正：扫描每个独立 buy/sell/purchase/short/liquidate 动作词，金融名词陈述例外仅校验当前词后紧邻的局部金融主体及报告系动词；不会消费或豁免同句后续动作。历史 short interest/purchase price 等合法说明可以出现在同一句；每个后续动作仍独立验证。
+
+新增回归覆盖：
+- 复审三条混合句，以及 therefore/please、and/we advise、liquidate 等连接后的命令；在标题、摘要、限制、问题、推断五类文字字段均拒绝。
+- 同句多个合法历史名词陈述及分句历史陈述继续接受。
+
+红阶段：`node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`：35 项，34 通过、1 失败，退出码 1。失败确认第一条历史说明加同句 purchase 命令被错误接受；新增纯历史正向基线通过。
+
+最终验证：
+- `node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`：35/35 通过，0 失败，退出码 0。
+- `node node_modules/typescript/bin/tsc --noEmit --allowImportingTsExtensions --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。
+- `node node_modules/eslint/bin/eslint.js lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。
+
+判断标准：原 33 项继续通过，混合句中明确交易动作逐个拒绝，多个合法历史短语继续接受。没有变更领域类型、状态机或调用方；只修改 report.ts、report.test.ts 并追加阶段报告，未读取密钥、未提交。
diff --git a/lib/buddy/report.ts b/lib/buddy/report.ts
index 45b6e23..b546d86 100644
--- a/lib/buddy/report.ts
+++ b/lib/buddy/report.ts
@@ -79,24 +79,31 @@ function rawAt(raw: unknown, path: string): unknown {
   }
   if (current === undefined) invalid("Raw path is undefined");
   return current;
 }
 
 const disallowed = /(?:\b(?:guaranteed?|risk[- ]?free|certain|assured)\b.{0,60}\b(?:return|profit|gain|price)\b|\b(?:price|stock|share)\b.{0,80}\b(?:will|must|certainly)\b.{0,50}\b(?:reach|rise|fall|hit|increase|decrease|double)\b|\b(?:buy|sell)\s+(?!and\b|or\b)[A-Z][A-Z0-9.:-]{0,15}\b|\b(?:buy|sell)\b.{0,40}\b(?:now|immediately|today)\b|(?:立即|现在|建议|应当|应该|务必|马上).{0,30}(?:买入|卖出|购买|抛售)|(?:买入|卖出).{0,20}(?:股票|股份|证券)|(?:股价|价格|收益|回报).{0,40}(?:必定|一定|保证|必然|将会|肯定)|(?:保证|保本|稳赚|必赚).{0,30}(?:收益|回报|盈利|上涨)?)/i;
 
 function validateText(text: string): void {
   const normalized = text.normalize("NFKC").replace(/\s+/g, " ");
   const futureTarget = /\b(?:will|must|certainly|definitely)\b.{0,50}\b(?:reach|hit|rise|fall|increase|decrease|double|trade|be)\b.{0,30}(?:[$€£¥]?\s*\d)/i;
-  const tradingAction = /(?:^|[.!?;。！？；]\s*)(?:please\s+|you\s+(?:should|must)\s+|(?:we\s+)?(?:recommend|advise)\s+(?:you\s+to\s+)?)?(?:buy|sell|purchase|short|liquidate)\b[^.!?;。！？；]{0,80}/gi;
-  // Nominal financial subjects followed by a reporting copula describe data rather than directing a trade.
-  const financialSubject = /(?:^|[.!?;。！？；]\s*)(?:short\s+(?:interest|positions?|exposure|volume)|purchase\s+(?:price|costs?|orders?))\b(?:\s+[A-Za-z]+){0,3}\s+(?:is|are|was|were|has|have|had)\b/i;
-  const unsafeTradingAction = [...normalized.matchAll(tradingAction)].some(match => !financialSubject.test(match[0]));
+  const reportingPredicate = "\\b(?:\\s+[A-Za-z]+){0,3}\\s+(?:is|are|was|were|has|have|had)\\b";
+  const shortSubject = new RegExp("^\\s+(?:interest|positions?|exposure|volume)" + reportingPredicate, "i");
+  const purchaseSubject = new RegExp("^\\s+(?:price|costs?|orders?)" + reportingPredicate, "i");
+  // Each lexical action is checked separately. A local nominal subject exempts only its own token.
+  const unsafeTradingAction = [...normalized.matchAll(/\b(buy|sell|purchase|short|liquidate)\b/gi)].some(match => {
+    const action = match[1].toLowerCase();
+    const local = normalized.slice(match.index! + match[0].length).split(/[,.!?;。！？；]/, 1)[0];
+    if (action === "short" && shortSubject.test(local)) return false;
+    if (action === "purchase" && purchaseSubject.test(local)) return false;
+    return true;
+  });
   const directChinese = /(?:^|[。！？；;.!?]\s*)(?:(?:请|立即|现在|建议|应当|应该|务必|马上)\s*)*(?:买入|卖出|购买|抛售|做空|减仓|加仓)[^。！？；;.!?]{1,60}/;
   if (disallowed.test(normalized) || futureTarget.test(normalized) || unsafeTradingAction || directChinese.test(normalized) || /\bwill\b.{0,60}(?:[$€£]\s*\d|\bbe\s+\d)|(?:未来|明天|下周|下月).{0,30}(?:价格|股价).{0,20}\d/i.test(normalized)) invalid("Forecast, return guarantee or trading instruction");
 }
 
 /** Numeric facts require every stated number and its literal unit to match the exact source. */
 function validateFactText(text: string, value: number | string | null, e: Evidence, unit: string): void {
   let factual = text.normalize("NFKC");
   for (const token of [e.symbol, e.scope, e.asOf, e.retrievedAt, ...(e.metrics?.map(metric => metric.period) ?? [])]) {
     if (token) factual = factual.split(token.normalize("NFKC")).join(" ");
   }
@@ -181,10 +188,11 @@ export function exportReport(run: AgentRun, format: "markdown" | "json"): string
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
index d4f3c04..666e4a1 100644
--- a/tests/report.test.ts
+++ b/tests/report.test.ts
@@ -101,10 +101,26 @@ test("review R2 accepts exact compact numeric units and trusted scope or period"
 });
 test("review R2 accepts financial noun phrases and historical prose while rejecting commands", () => {
  for (const text of ["Short interest is disclosed in historical data.", "Purchase price was 100 USD yesterday.", "Short positions were disclosed in the annual report.", "Purchase costs are recorded in historical data."]) {
   for (const field of ["title", "summary", "limitations", "questions", "claim"] as const) {
    const r = report(); if (field === "limitations" || field === "questions") r[field] = [text]; else if (field === "claim") r.claims[0] = { id: "i", kind: "inference", text, evidenceIds: ["e1"] }; else r[field] = text;
    assert.doesNotThrow(() => validateReport(r, [e]), text);
   }
  }
  for (const text of ["Short AAPL immediately.", "Purchase AAPL immediately.", "You should purchase AAPL.", "Please short shares of AAPL."]) { const r = report(); r.summary = text; assert.throws(() => validateReport(r, [e]), text); }
 });
+
+
+test("review R3 historical nouns never exempt later trading actions in the same sentence", () => {
+ const mixed = ["Short interest is disclosed, so purchase AAPL immediately.", "Purchase price was 100 USD yesterday, purchase AAPL immediately.", "Short interest is disclosed and you should short AAPL now.", "Short interest is disclosed, therefore please purchase AAPL.", "Purchase costs are recorded and we advise you to short AAPL.", "Short positions were disclosed, liquidate AAPL immediately."];
+ for (const text of mixed) {
+  for (const field of ["title", "summary", "limitations", "questions", "claim"] as const) {
+   const r = report(); if (field === "limitations" || field === "questions") r[field] = [text]; else if (field === "claim") r.claims[0] = { id: "i", kind: "inference", text, evidenceIds: ["e1"] }; else r[field] = text;
+   assert.throws(() => validateReport(r, [e]), field + ": " + text);
+  }
+ }
+});
+test("review R3 multiple local historical noun phrases remain accepted", () => {
+ for (const text of ["Short interest is disclosed and purchase price was 100 USD yesterday.", "Purchase costs are recorded, and short positions were disclosed in the annual report.", "Short interest is disclosed. Purchase price was 100 USD yesterday."]) {
+  const r = report(); r.summary = text; assert.doesNotThrow(() => validateReport(r, [e]));
+ }
+});
