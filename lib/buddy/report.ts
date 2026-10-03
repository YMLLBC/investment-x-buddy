import type { AgentRun, Evidence, ResearchReport } from "./types.ts";

const forbiddenKeys = /^(?:__proto__|prototype|constructor)$/;
const sensitiveLabel = "authorization|api[-_]?key|(?:access|refresh|session)[-_]?token|token|session|owner[-_]?id|secret|password|credentials?";
const sensitiveKey = new RegExp(sensitiveLabel, "i");
const sensitiveText = new RegExp("\\b(" + sensitiveLabel + ")[\"']?\\s*[:=]\\s*(?:\"[^\"\\r\\n]*\"|'[^'\\r\\n]*'|[^\\s,;\"'&}]+)", "gi");
function redactUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s<>"']+/gi, source => {
    try {
      const url = new URL(source);
      let changed = false;
      for (const key of [...url.searchParams.keys()]) {
        if (sensitiveKey.test(key)) { url.searchParams.set(key, "[REDACTED]"); changed = true; }
      }
      if (url.username || url.password) { url.username = ""; url.password = ""; changed = true; }
      return changed ? url.toString() : source;
    } catch { return source; }
  });
}
const reasoningKey = /reasoning|chain.?of.?thought|scratchpad|^analysis$|^thoughts$/i;

/** Deterministic redaction for exports and diagnostic events; no credentials are needed by this module. */
export function redactText(text: string): string {
  return redactUrls(text)
    .replace(/\bAuthorization["']?\s*[:=]\s*["']?[^\r\n,;"'}]+/gi, "Authorization: [REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
    .replace(sensitiveText, "$1=[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 30) return "[DEPTH_LIMIT]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(item => redactValue(item, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (reasoningKey.test(key) || forbiddenKeys.test(key)) continue;
      output[key] = sensitiveKey.test(key) ? "[REDACTED]" : redactValue(entry, depth + 1);
    }
    return output;
  }
  return value;
}

function invalid(message: string): never { throw new Error("INVALID_REPORT: " + message); }
function string(value: unknown, name: string, max = 2000, empty = false): asserts value is string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) invalid("Invalid " + name);
}
function timestamp(value: unknown, name: string): void {
  string(value, name, 64);
  if (!Number.isFinite(Date.parse(value))) invalid("Invalid " + name);
}

/** Validate provenance before ingestion; missing/stale evidence remains usable only as caveat data. */
export function validateEvidence(e: Evidence): void {
  if (!e || typeof e !== "object") invalid("Invalid evidence");
  string(e.id, "evidence ID", 100); string(e.title, "evidence title", 500);
  string(e.provider, "provider", 200); string(e.sourceUrl, "source URL", 2000);
  try { if (!["http:", "https:"].includes(new URL(e.sourceUrl).protocol)) invalid("Invalid source URL"); } catch { invalid("Invalid source URL"); }
  timestamp(e.retrievedAt, "retrievedAt");
  if (e.asOf !== null) timestamp(e.asOf, "asOf");
  string(e.unit, "unit", 100); string(e.scope, "scope", 500); string(e.hash, "hash", 200);
  string(e.summary, "evidence summary", 10000, true);
  if (!["valid", "missing", "stale", "conflict"].includes(e.quality)) invalid("Invalid evidence quality");
  if (!Object.hasOwn(e, "raw") || e.raw === undefined) invalid("Missing raw evidence");
}

function rawAt(raw: unknown, path: string): unknown {
  string(path, "verification field path", 500);
  const parts = path.split(".");
  if (parts.length > 30 || parts.some(part => !part || forbiddenKeys.test(part))) invalid("Unsafe verification path");
  let current: unknown = raw;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, part)) invalid("Raw path does not exist");
    current = (current as Record<string, unknown>)[part];
  }
  if (current === undefined) invalid("Raw path is undefined");
  return current;
}

const disallowed = /(?:\b(?:guaranteed?|risk[- ]?free|certain|assured)\b.{0,60}\b(?:return|profit|gain|price)\b|\b(?:price|stock|share)\b.{0,80}\b(?:will|must|certainly)\b.{0,50}\b(?:reach|rise|fall|hit|increase|decrease|double)\b|\b(?:buy|sell)\s+(?!and\b|or\b)[A-Z][A-Z0-9.:-]{0,15}\b|\b(?:buy|sell)\b.{0,40}\b(?:now|immediately|today)\b|(?:立即|现在|建议|应当|应该|务必|马上).{0,30}(?:买入|卖出|购买|抛售)|(?:买入|卖出).{0,20}(?:股票|股份|证券)|(?:股价|价格|收益|回报).{0,40}(?:必定|一定|保证|必然|将会|肯定)|(?:保证|保本|稳赚|必赚).{0,30}(?:收益|回报|盈利|上涨)?)/i;

function validateText(text: string): void {
  const normalized = text.normalize("NFKC").replace(/\s+/g, " ");
  const futureTarget = /\b(?:will|must|certainly|definitely)\b.{0,50}\b(?:reach|hit|rise|fall|increase|decrease|double|trade|be)\b.{0,30}(?:[$€£¥]?\s*\d)/i;
  const reportingPredicate = "\\b(?:\\s+[A-Za-z]+){0,3}\\s+(?:is|are|was|were|has|have|had)\\b";
  const shortSubject = new RegExp("^\\s+(?:interest|positions?|exposure|volume)" + reportingPredicate, "i");
  const purchaseSubject = new RegExp("^\\s+(?:price|costs?|orders?)" + reportingPredicate, "i");
  // Local noun/adjective exceptions exempt only their own token; later actions are still checked.
  const unsafeTradingAction = [...normalized.matchAll(/\b(buy|sell|purchase|short|liquidate)\b/gi)].some(match => {
    const action = match[1].toLowerCase();
    const local = normalized.slice(match.index! + match[0].length).split(/[,.!?;。！？；]/, 1)[0];
    if (action === "short" && (/^-term\b/i.test(local) || shortSubject.test(local))) return false;
    if (action === "purchase" && purchaseSubject.test(local)) return false;
    return true;
  });
  const directChinese = /(?:^|[。！？；;.!?]\s*)(?:(?:请|立即|现在|建议|应当|应该|务必|马上)\s*)*(?:买入|卖出|购买|抛售|做空|减仓|加仓)[^。！？；;.!?]{1,60}/;
  if (disallowed.test(normalized) || futureTarget.test(normalized) || unsafeTradingAction || directChinese.test(normalized) || /\bwill\b.{0,60}(?:[$€£]\s*\d|\bbe\s+\d)|(?:未来|明天|下周|下月).{0,30}(?:价格|股价).{0,20}\d/i.test(normalized)) invalid("Forecast, return guarantee or trading instruction");
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
  // Remove only trusted symbol/period metadata above; every remaining numeric token must be checked, including 200USD.
  const matches = [...factual.matchAll(/[-+]?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?/g)];
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
      const afterSpace = afterNumber.slice(spacing);
      if (!afterSpace.startsWith(literalUnit)) invalid("Numeric fact must use the exact verified unit");
      const suffix = afterSpace.slice(literalUnit.length);
      if (/^[A-Za-z%％/]/.test(suffix) || /^[ \t]*(?:per\b|each\b|每|\/)/i.test(suffix) || /[$€£¥￥]\s*$/.test(prefix)) invalid("Numeric fact has an additional or conflicting unit");
      remainder = remainder.slice(0, start) + " " + remainder.slice(start + match[0].length + spacing + literalUnit.length);
    }
    if (/\b(?:USD|EUR|CNY|RMB|GBP|JPY|HKD|CAD|AUD|CHF|INR|KRW|shares?|percent|dollars?|yuan)\b|[%％$€£¥￥]|(?:亿元|万元|人民币|美元|欧元|港元|日元)|(?:每股|每份)/i.test(remainder)) invalid("Numeric fact has an unsupported additional unit");
  } else if (value === null) {
    if (matches.length) invalid("Null raw value cannot support numeric fact");
  } else {
    if (typeof value !== "string" || !text.includes(value)) invalid("String fact must include verified raw value");
    if (matches.length) invalid("Non-numeric raw strings cannot support numeric facts");
  }
}

export function validateReport(report: ResearchReport, evidence: Evidence[]): ResearchReport {
  if (!report || typeof report !== "object") invalid("Missing report");
  string(report.title, "title", 500); string(report.summary, "summary", 6000); timestamp(report.generatedAt, "generatedAt");
  if (!Array.isArray(report.claims) || report.claims.length > 100 || !Array.isArray(report.limitations) || report.limitations.length > 30 || !Array.isArray(report.questions) || report.questions.length > 30) invalid("Invalid report arrays");
  for (const text of [...report.limitations, ...report.questions]) { string(text, "report item", 2000); validateText(text); }
  validateText(report.title); validateText(report.summary);
  if (!Array.isArray(evidence) || evidence.length > 500) invalid("Invalid evidence list");
  const sources = new Map<string, Evidence>();
  for (const e of evidence) { validateEvidence(e); if (sources.has(e.id)) invalid("Duplicate evidence ID"); sources.set(e.id, e); }
  const claims = new Set<string>();
  for (const claim of report.claims) {
    if (!claim || typeof claim !== "object") invalid("Invalid claim");
    string(claim.id, "claim ID", 100); string(claim.text, "claim text", 3000); validateText(claim.text);
    if (claims.has(claim.id)) invalid("Duplicate claim ID"); claims.add(claim.id);
    if (!["fact", "inference", "unknown"].includes(claim.kind) || !Array.isArray(claim.evidenceIds) || claim.evidenceIds.length > 30) invalid("Invalid claim");
    if (new Set(claim.evidenceIds).size !== claim.evidenceIds.length) invalid("Duplicate citation");
    for (const id of claim.evidenceIds) { string(id, "citation", 100); if (!sources.has(id)) invalid("Unavailable citation"); }
    if (claim.kind !== "unknown" && !claim.evidenceIds.length) invalid("Claim needs citations");
    if (claim.kind === "fact") {
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
      validateFactText(claim.text, v.value, e, v.unit);
    }
  }
  return structuredClone(report);
}

function escapeMarkdown(value: unknown): string {
  return redactText(String(value)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/([\\\x60*_{}\[\]#|])/g, "\\$1").replace(/\r?\n/g, " ");
}

export function exportReport(run: AgentRun, format: "markdown" | "json"): string {
  if (!run.report) invalid("No report available");
  if (format !== "markdown" && format !== "json") invalid("Invalid export format");
  const report = validateReport(run.report, run.evidence);
  // Allowlisted shape deliberately excludes owner ID, task arguments, event diagnostics and model reasoning.
  const publicReport: ResearchReport = { title: report.title, summary: report.summary, generatedAt: report.generatedAt, limitations: report.limitations, questions: report.questions, claims: report.claims.map(c => ({ id: c.id, kind: c.kind, text: c.text, evidenceIds: c.evidenceIds, ...(c.verification ? { verification: { evidenceId: c.verification.evidenceId, fieldPath: c.verification.fieldPath, value: c.verification.value, unit: c.verification.unit } } : {}) })) };
  const data = redactValue({ title: run.title, goal: run.goal, mode: run.mode, report: publicReport, evidence: run.evidence.map(e => ({ id: e.id, title: e.title, provider: e.provider, sourceUrl: e.sourceUrl, retrievedAt: e.retrievedAt, asOf: e.asOf, unit: e.unit, scope: e.scope, hash: e.hash, quality: e.quality, summary: e.summary, raw: e.raw })) }) as { report: ResearchReport; evidence: Evidence[] };
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



