# Harness fix round 4
BASE f1886f4a3efdb677a7548120fc484004ca04dca8
HEAD db3509fa541d2459070145f147f6b2f19dabd66a
diff --git a/docs/stages/TASK_02_REPORT.md b/docs/stages/TASK_02_REPORT.md
index 5a6f161..806e64e 100644
--- a/docs/stages/TASK_02_REPORT.md
+++ b/docs/stages/TASK_02_REPORT.md
@@ -92,10 +92,32 @@
 - 同句多个合法历史名词陈述及分句历史陈述继续接受。
 
 红阶段：`node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`：35 项，34 通过、1 失败，退出码 1。失败确认第一条历史说明加同句 purchase 命令被错误接受；新增纯历史正向基线通过。
 
 最终验证：
 - `node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`：35/35 通过，0 失败，退出码 0。
 - `node node_modules/typescript/bin/tsc --noEmit --allowImportingTsExtensions --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。
 - `node node_modules/eslint/bin/eslint.js lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。
 
 判断标准：原 33 项继续通过，混合句中明确交易动作逐个拒绝，多个合法历史短语继续接受。没有变更领域类型、状态机或调用方；只修改 report.ts、report.test.ts 并追加阶段报告，未读取密钥、未提交。
+
+## 审查修正第 4 轮（2026-10-02）
+
+依据 docs/reviews/TASK_02_REREVIEW_3.md 的 short-term debt 误拒绝 P2，已完成限定修正，等待独立复审。原 35 项测试完整保留，追加 2 项回归测试。
+
+根因与修正：动作扫描使用单词边界，因此 short-term 中的 short 也会成为候选动作。仅当当前 short token 后紧邻完整的 -term 词时，按复合形容词给予局部例外；原逐 token 扫描及金融名词规则保留，同句其他 purchase/short 等动作仍单独检查。没有恢复整句豁免，也没有修改数字、单位、证据、脱敏或运行状态逻辑。
+
+新增覆盖：普通短期债务说明、历史短期债务说明、大小写变体及同句 purchase costs 名词说明，在标题、摘要、限制、问题和推断五类字段接受；明确 Short AAPL immediately，以及短期债务说明前后或同句的 purchase/short 命令，在上述五类字段均拒绝。
+
+红阶段（先追加测试、尚未修改实现）：
+- 命令：`node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`。
+- 结果：37 项，36 通过、1 失败，退出码 1。新增正常说明测试在 title 的 The company has short-term debt. 上报“出现了不应发生的异常”，实际错误为“报告无效：预测、回报保证或交易指令”；原 35 项和新增混合命令拒绝测试通过。此失败验证了合法语境误拒绝，非导入或语法错误。
+
+绿阶段与静态检查（工作目录 D:/projects/THSwork/investment-x-buddy）：
+- `node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`：37/37 通过，0 失败，退出码 0。
+- `node node_modules/typescript/bin/tsc --noEmit --allowImportingTsExtensions --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。
+- `node node_modules/eslint/bin/eslint.js lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。
+- 将 TASK_02_REREVIEW_1.md 的 5 条探针、TASK_02_REREVIEW_2.md 的 3 条断言和 TASK_02_REREVIEW_3.md 的短期债务断言组合于内存，通过 `$probe | node --experimental-strip-types --input-type=module` 执行：9/9 通过，0 失败，退出码 0，未生成探针文件。
+
+成功标准：原 35 项与新增 2 项同时通过；短期债务正常陈述接受；明确做空指令和同句混合命令拒绝；复审组合 9 条全部通过；限定 TypeScript/ESLint 退出码均为 0。以上标准实际满足，仅代表限定模块和样例验证，不表示任意自然语言或服务器集成已验证。
+
+本轮只修改 lib/buddy/report.ts、tests/report.test.ts 并追加本报告；未提交、未读密钥、未改 ACL。三个正式文件均位于 D 盘项目，本轮 apply_patch 写入成功；未生成需要清理的 C 盘缓存。
diff --git a/lib/buddy/report.ts b/lib/buddy/report.ts
index b546d86..9a76cd9 100644
--- a/lib/buddy/report.ts
+++ b/lib/buddy/report.ts
@@ -82,25 +82,25 @@ function rawAt(raw: unknown, path: string): unknown {
 }
 
 const disallowed = /(?:\b(?:guaranteed?|risk[- ]?free|certain|assured)\b.{0,60}\b(?:return|profit|gain|price)\b|\b(?:price|stock|share)\b.{0,80}\b(?:will|must|certainly)\b.{0,50}\b(?:reach|rise|fall|hit|increase|decrease|double)\b|\b(?:buy|sell)\s+(?!and\b|or\b)[A-Z][A-Z0-9.:-]{0,15}\b|\b(?:buy|sell)\b.{0,40}\b(?:now|immediately|today)\b|(?:立即|现在|建议|应当|应该|务必|马上).{0,30}(?:买入|卖出|购买|抛售)|(?:买入|卖出).{0,20}(?:股票|股份|证券)|(?:股价|价格|收益|回报).{0,40}(?:必定|一定|保证|必然|将会|肯定)|(?:保证|保本|稳赚|必赚).{0,30}(?:收益|回报|盈利|上涨)?)/i;
 
 function validateText(text: string): void {
   const normalized = text.normalize("NFKC").replace(/\s+/g, " ");
   const futureTarget = /\b(?:will|must|certainly|definitely)\b.{0,50}\b(?:reach|hit|rise|fall|increase|decrease|double|trade|be)\b.{0,30}(?:[$€£¥]?\s*\d)/i;
   const reportingPredicate = "\\b(?:\\s+[A-Za-z]+){0,3}\\s+(?:is|are|was|were|has|have|had)\\b";
   const shortSubject = new RegExp("^\\s+(?:interest|positions?|exposure|volume)" + reportingPredicate, "i");
   const purchaseSubject = new RegExp("^\\s+(?:price|costs?|orders?)" + reportingPredicate, "i");
-  // Each lexical action is checked separately. A local nominal subject exempts only its own token.
+  // Local noun/adjective exceptions exempt only their own token; later actions are still checked.
   const unsafeTradingAction = [...normalized.matchAll(/\b(buy|sell|purchase|short|liquidate)\b/gi)].some(match => {
     const action = match[1].toLowerCase();
     const local = normalized.slice(match.index! + match[0].length).split(/[,.!?;。！？；]/, 1)[0];
-    if (action === "short" && shortSubject.test(local)) return false;
+    if (action === "short" && (/^-term\b/i.test(local) || shortSubject.test(local))) return false;
     if (action === "purchase" && purchaseSubject.test(local)) return false;
     return true;
   });
   const directChinese = /(?:^|[。！？；;.!?]\s*)(?:(?:请|立即|现在|建议|应当|应该|务必|马上)\s*)*(?:买入|卖出|购买|抛售|做空|减仓|加仓)[^。！？；;.!?]{1,60}/;
   if (disallowed.test(normalized) || futureTarget.test(normalized) || unsafeTradingAction || directChinese.test(normalized) || /\bwill\b.{0,60}(?:[$€£]\s*\d|\bbe\s+\d)|(?:未来|明天|下周|下月).{0,30}(?:价格|股价).{0,20}\d/i.test(normalized)) invalid("Forecast, return guarantee or trading instruction");
 }
 
 /** Numeric facts require every stated number and its literal unit to match the exact source. */
 function validateFactText(text: string, value: number | string | null, e: Evidence, unit: string): void {
   let factual = text.normalize("NFKC");
diff --git a/tests/report.test.ts b/tests/report.test.ts
index 666e4a1..8b95ffe 100644
--- a/tests/report.test.ts
+++ b/tests/report.test.ts
@@ -117,10 +117,29 @@ test("review R3 historical nouns never exempt later trading actions in the same
    const r = report(); if (field === "limitations" || field === "questions") r[field] = [text]; else if (field === "claim") r.claims[0] = { id: "i", kind: "inference", text, evidenceIds: ["e1"] }; else r[field] = text;
    assert.throws(() => validateReport(r, [e]), field + ": " + text);
   }
  }
 });
 test("review R3 multiple local historical noun phrases remain accepted", () => {
  for (const text of ["Short interest is disclosed and purchase price was 100 USD yesterday.", "Purchase costs are recorded, and short positions were disclosed in the annual report.", "Short interest is disclosed. Purchase price was 100 USD yesterday."]) {
   const r = report(); r.summary = text; assert.doesNotThrow(() => validateReport(r, [e]));
  }
 });
+
+test("review R4 accepts short-term descriptive prose across report fields", () => {
+ for (const text of ["The company has short-term debt.", "Short-term debt was disclosed in the annual report.", "SHORT-TERM financing was recorded and purchase costs are disclosed."]) {
+  for (const field of ["title", "summary", "limitations", "questions", "claim"] as const) {
+   const r = report(); if (field === "limitations" || field === "questions") r[field] = [text]; else if (field === "claim") r.claims[0] = { id: "i", kind: "inference", text, evidenceIds: ["e1"] }; else r[field] = text;
+   assert.doesNotThrow(() => validateReport(r, [e]), field + ": " + text);
+  }
+ }
+});
+
+test("review R4 short-term adjectives never exempt explicit or later trading actions", () => {
+ const mixed = ["Short AAPL immediately.", "The company has short-term debt, so purchase AAPL immediately.", "The company has short-term debt and you should short AAPL now.", "Short-term debt was disclosed, therefore please purchase AAPL.", "Purchase costs are recorded and short-term debt was disclosed, so short AAPL immediately.", "Short AAPL immediately because the company has short-term debt."];
+ for (const text of mixed) {
+  for (const field of ["title", "summary", "limitations", "questions", "claim"] as const) {
+   const r = report(); if (field === "limitations" || field === "questions") r[field] = [text]; else if (field === "claim") r.claims[0] = { id: "i", kind: "inference", text, evidenceIds: ["e1"] }; else r[field] = text;
+   assert.throws(() => validateReport(r, [e]), field + ": " + text);
+  }
+ }
+});
