export type RunMode = "demo" | "live";
export type RunStatus = "awaiting_approval" | "running" | "paused" | "failed" | "completed" | "stopped";
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type EvidenceQuality = "valid" | "missing" | "stale" | "conflict";
export interface AgentTask { id: string; title: string; tool: string; arguments: Record<string, unknown>; status: TaskStatus; attempts: number; error?: string; }
export interface FinancialMetric { key: string; label: string; value: number | null; unit: string; period?: string; symbol?: string; fieldPath?: string; }
export interface Evidence { id: string; title: string; provider: string; sourceUrl: string; retrievedAt: string; asOf: string | null; unit: string; scope: string; quality: EvidenceQuality; summary: string; raw: unknown; hash: string; metrics?: FinancialMetric[]; series?: { date: string; value: number | null }[]; symbol?: string; }
export interface AgentEvent { id: string; at: string; type: string; message: string; taskId?: string; details?: Record<string, unknown>; }
export interface ResearchClaim { id: string; kind: "fact" | "inference" | "unknown"; text: string; evidenceIds: string[]; verification?: { evidenceId: string; fieldPath: string; value: number | string | null; unit: string }; }
export interface ResearchReport { title: string; summary: string; claims: ResearchClaim[]; limitations: string[]; questions: string[]; generatedAt: string; }
export interface RunLimits { maxToolCalls: number; maxModelCalls: number; maxEstimatedUsd: number; maxRuntimeMs: number; }
export interface RunMetrics { toolCalls: number; modelCalls: number; inputTokens: number; outputTokens: number; estimatedUsd: number; elapsedMs: number; startedAt?: string; }
export interface MemoryEntry { id: string; text: string; kind: "preference" | "research"; createdAt: string; }
export interface AgentRun { id: string; ownerId: string; goal: string; title: string; mode: RunMode; status: RunStatus; createdAt: string; updatedAt: string; approved: boolean; plan: AgentTask[]; evidence: Evidence[]; events: AgentEvent[]; report?: ResearchReport; contextSummary: string; metrics: RunMetrics; limits: RunLimits; version: number; stopReason?: string; checkpoint: { cursor: number; completedTaskIds: string[]; savedAt: string }; memory: MemoryEntry[]; parentId?: string; }
export interface ToolDefinition { name: string; title: string; description: string; source: string; permission: "read"; requiresApproval: boolean; inputSchema: Record<string, unknown>; }
export interface Session { ownerId: string; mode: RunMode; expiresAt: number; }
export interface ResearchInput { goal: string; mode: RunMode; symbols: string[]; scenario?: "normal" | "missing" | "failure"; parentId?: string; }
export interface PlanningResult { title: string; tasks: { title: string; tool: string; arguments: Record<string, unknown> }[]; limitations: string[]; }
export interface ModelUsage { inputTokens: number; outputTokens: number; estimatedUsd: number; }
