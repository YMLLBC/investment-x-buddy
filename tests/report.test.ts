import assert from "node:assert/strict";
import { test } from "node:test";
import { validateReport, exportReport } from "../lib/buddy/report.ts";
import { createRun } from "../lib/buddy/harness.ts";
import type { Evidence, ResearchReport } from "../lib/buddy/types.ts";
const now = "2026-10-02T00:00:00.000Z";
const e: Evidence = { id: "e1", title: "Quote", provider: "Demo", sourceUrl: "https://example.com", retrievedAt: now, asOf: now, unit: "USD", scope: "AAPL", quality: "valid", summary: "Quote", raw: { quote: { price: 100, missing: null }, rows: [{ value: 20 }] }, hash: "abc" };
const report = (): ResearchReport => ({ title: "Research", summary: "Observed data", claims: [{ id: "c1", kind: "fact", text: "Price is 100 USD", evidenceIds: ["e1"], verification: { evidenceId: "e1", fieldPath: "quote.price", value: 100, unit: "USD" } }], limitations: ["Prices change"], questions: [], generatedAt: now });
test("facts validate exact raw paths values and units", () => {
 assert.deepEqual(validateReport(report(), [e]), report()); for (const patch of [{ fieldPath: "quote.absent", value: null }, { value: 101 }, { unit: "EUR" }, { fieldPath: "__proto__.x" }]) { const r = report(); Object.assign(r.claims[0].verification!, patch); assert.throws(() => validateReport(r, [e])); }
 const r = report(); r.claims[0].verification = { evidenceId: "e1", fieldPath: "rows.0.value", value: 20, unit: "USD" }; r.claims[0].text = "Value is 20 USD"; validateReport(r, [e]);
});
test("facts cannot use missing stale conflict evidence or missing metadata", () => {
 validateReport(report(), [e]);
 for (const quality of ["missing", "stale", "conflict"] as const) assert.throws(() => validateReport(report(), [{ ...e, quality }]));
 for (const patch of [{ provider: "" }, { sourceUrl: "" }, { hash: "" }, { asOf: null }, { scope: "" }]) assert.throws(() => validateReport(report(), [{ ...e, ...patch }]));
 assert.throws(() => validateReport(report(), [])); const r = report(); delete r.claims[0].verification; assert.throws(() => validateReport(r, [e]));
});
test("numeric fact text cannot contradict verified value", () => { validateReport(report(), [e]); const r = report(); r.claims[0].text = "Price is 200 USD"; assert.throws(() => validateReport(r, [e])); });
test("inferences cite evidence unknown claims can omit citations", () => {
 const r = report(); r.claims[0] = { id: "c", kind: "inference", text: "Further research is needed", evidenceIds: [] }; assert.throws(() => validateReport(r, [e])); r.claims[0].evidenceIds = ["e1"]; validateReport(r, [e]); r.claims[0] = { id: "u", kind: "unknown", text: "Future price is unknown", evidenceIds: [] }; validateReport(r, [e]);
});
test("reports reject forecasts guarantees directives and oversized data", () => {
 validateReport(report(), [e]);
 for (const text of ["Price will reach 500 tomorrow", "Guaranteed 20% return", "Buy AAPL now", "立即卖出 AAPL", "股价必定上涨"]) { const r = report(); r.summary = text; assert.throws(() => validateReport(r, [e])); } const r = report(); r.title = "x".repeat(501); assert.throws(() => validateReport(r, [e]));
});
test("exports include verification metadata and redact secrets recursively", () => {
 const r = createRun({ id: "r", ownerId: "OWNER_SECRET", goal: "Research", title: "R", mode: "demo", plan: [{ id: "t", title: "Read", tool: "quote", arguments: {}, status: "pending", attempts: 0 }], now });
 r.report = report(); r.evidence = [{ ...e, raw: { ...e.raw as object, apiKey: "API_SECRET", Authorization: "Bearer AUTH_SECRET", nested: { sessionToken: "SESSION_SECRET", note: "sk-abcdefghijklmnop1234567890 eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiMTIzIn0.abcdefghijklmnopqrstuvwxyz" } } }];
 const md = exportReport(r, "markdown"), json = exportReport(r, "json");
 for (const value of [md, json]) { assert.match(value, /quote.price/); assert.match(value, /USD/); assert.match(value, /abc/); assert.doesNotMatch(value, /OWNER_SECRET|API_SECRET|AUTH_SECRET|SESSION_SECRET|sk-abcdefghijkl|eyJhbGci/); }
 assert.match(md, /fact/); assert.match(md, /https:\/\/example.com/); assert.throws(() => exportReport({ ...r, report: undefined }, "json"));
});

test("existing null raw field can verify unavailable data but absent null cannot", () => {
 const r = report(); r.claims[0].text = "Price data is unavailable"; r.claims[0].verification = { evidenceId: "e1", fieldPath: "quote.missing", value: null, unit: "USD" };
 validateReport(r, [e]); r.claims[0].verification.fieldPath = "quote.absent"; assert.throws(() => validateReport(r, [e]));
});
test("exports redact embedded JSON credentials and omit unrecognized reasoning payloads", () => {
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


test("review R1 numeric facts bind text units and reject contradictory numeric strings", () => {
 validateReport(report(), [e]);
 for (const text of ["Price is 100 EUR", "Price is 100%", "Price is 100 USD and 100 EUR", "Price is $100 USD", "Price is 100 USD per share"]) { const r = report(); r.claims[0].text = text; assert.throws(() => validateReport(r, [e]), text); }
 const stringEvidence = { ...e, raw: { quote: { price: "100" } } }, r = report();
 r.claims[0].verification!.value = "100"; validateReport(r, [stringEvidence]);
 r.claims[0].text = "Price is 200 USD (source 100)"; assert.throws(() => validateReport(r, [stringEvidence]));
});
test("review R1 accepts precise float and literal metric units while rejecting extra values", () => {
 const cases = [{ value: 0.30000000000000004, unit: "CNY 元" }, { value: "12.3400", unit: "CNY 元" }, { value: "1e-7", unit: "%" }];
 for (const { value, unit } of cases) {
  const metricEvidence = { ...e, unit: "mixed", raw: { value }, metrics: [{ key: "metric", label: "Metric", value: Number(value), unit, fieldPath: "value" }] };
  const r = report(); r.claims[0].text = "Metric: " + value + " " + unit; r.claims[0].verification = { evidenceId: "e1", fieldPath: "value", value, unit };
  validateReport(r, [metricEvidence]); r.claims[0].text += " and 200 " + unit; assert.throws(() => validateReport(r, [metricEvidence]));
 }
 const r = report(); r.claims[0] = { id: "derived", kind: "inference", text: "Calculated estimate is 200 EUR", evidenceIds: ["e1"] }; validateReport(r, [e]);
});
test("review R1 rejects common deterministic forecasts and trade imperatives across fields", () => {
 const ordinary = report(); ordinary.summary = "AAPL reached 100 USD yesterday; future price is unknown. 不建议交易，未来价格未知。"; validateReport(ordinary, [e]);
 for (const text of ["AAPL will reach 500 tomorrow", "买入苹果", "Purchase AAPL immediately"]) {
  for (const field of ["title", "summary", "limitations", "questions", "claim"] as const) {
   const r = report(); if (field === "limitations" || field === "questions") r[field] = [text]; else if (field === "claim") r.claims[0] = { id: "i", kind: "inference", text, evidenceIds: ["e1"] }; else r[field] = text;
   assert.throws(() => validateReport(r, [e]), field + ": " + text);
  }
 }
});
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


test("review R2 rejects contradictory numbers attached to units including exports", () => {
 for (const text of ["Price is 200USD (source 100 USD)", "Price is 100 USD and 200EUR", "Price is 100USD and 200EUR", "Price is 100EUR", "Price is 100USD and 100EUR"]) {
  const r = report(); r.claims[0].text = text; assert.throws(() => validateReport(r, [e]), text);
  const run = createRun({ id: "r", ownerId: "o", goal: "Research", title: "R", mode: "demo", plan: [{ id: "t", title: "Read", tool: "quote", arguments: {}, status: "pending", attempts: 0 }], now }); run.report = r; run.evidence = [e];
  for (const format of ["json", "markdown"] as const) assert.throws(() => exportReport(run, format), text);
 }
});
test("review R2 accepts exact compact numeric units and trusted scope or period", () => {
 for (const text of ["Price is 100USD", "Price is 100 USD"]) { const r = report(); r.claims[0].text = text; validateReport(r, [e]); }
 const compact = { ...e, scope: "600519.SH", symbol: "600519.SH", raw: { value: "1e-7" }, metrics: [{ key: "v", label: "Value", value: 1e-7, unit: "CNY 元", fieldPath: "value", period: "2025Q4" }] };
 const r = report(); r.claims[0].text = "600519.SH 2025Q4 value: 1e-7CNY 元"; r.claims[0].verification = { evidenceId: "e1", fieldPath: "value", value: "1e-7", unit: "CNY 元" }; validateReport(r, [compact]);
 r.claims[0].text += " and 2e-7CNY 元"; assert.throws(() => validateReport(r, [compact]));
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


test("review R3 historical nouns never exempt later trading actions in the same sentence", () => {
 const mixed = ["Short interest is disclosed, so purchase AAPL immediately.", "Purchase price was 100 USD yesterday, purchase AAPL immediately.", "Short interest is disclosed and you should short AAPL now.", "Short interest is disclosed, therefore please purchase AAPL.", "Purchase costs are recorded and we advise you to short AAPL.", "Short positions were disclosed, liquidate AAPL immediately."];
 for (const text of mixed) {
  for (const field of ["title", "summary", "limitations", "questions", "claim"] as const) {
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

test("review R4 accepts short-term descriptive prose across report fields", () => {
 for (const text of ["The company has short-term debt.", "Short-term debt was disclosed in the annual report.", "SHORT-TERM financing was recorded and purchase costs are disclosed."]) {
  for (const field of ["title", "summary", "limitations", "questions", "claim"] as const) {
   const r = report(); if (field === "limitations" || field === "questions") r[field] = [text]; else if (field === "claim") r.claims[0] = { id: "i", kind: "inference", text, evidenceIds: ["e1"] }; else r[field] = text;
   assert.doesNotThrow(() => validateReport(r, [e]), field + ": " + text);
  }
 }
});

test("review R4 short-term adjectives never exempt explicit or later trading actions", () => {
 const mixed = ["Short AAPL immediately.", "The company has short-term debt, so purchase AAPL immediately.", "The company has short-term debt and you should short AAPL now.", "Short-term debt was disclosed, therefore please purchase AAPL.", "Purchase costs are recorded and short-term debt was disclosed, so short AAPL immediately.", "Short AAPL immediately because the company has short-term debt."];
 for (const text of mixed) {
  for (const field of ["title", "summary", "limitations", "questions", "claim"] as const) {
   const r = report(); if (field === "limitations" || field === "questions") r[field] = [text]; else if (field === "claim") r.claims[0] = { id: "i", kind: "inference", text, evidenceIds: ["e1"] }; else r[field] = text;
   assert.throws(() => validateReport(r, [e]), field + ": " + text);
  }
 }
});
