import type {AgentRun,MemoryEntry,RunMode,RunLimits,Session,ToolDefinition} from "./types";
import type {RunSummary} from "./repository";
import type {FinancialComparison} from "./data";
export interface RunView {run:Omit<AgentRun,"ownerId">;symbols:string[];scenario:"normal"|"missing"|"failure";planning:boolean;retryAt:number;executing:boolean;comparison:FinancialComparison}
export interface Bootstrap {session:Pick<Session,"mode"|"expiresAt">;runs:RunSummary[];memory:MemoryEntry[];tools:ToolDefinition[];limits:RunLimits;capabilities:{liveAvailable:boolean};dailyBudget?:{spent:number;reserved:number;cap:number}}
export class ApiError extends Error{constructor(public code:string,message:string){super(message)}}
export async function api<T>(path:string,mode:RunMode,body?:unknown,method?:string):Promise<T>{
 const url="/api/buddy/"+path+(path.includes("?")?"&":"?")+"mode="+mode;
 const r=await fetch(url,{method:method??(body===undefined?"GET":"POST"),credentials:"same-origin",cache:"no-store",headers:body!==undefined?{"Content-Type":"application/json","X-Buddy-Client":"workbench"}:undefined,...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const data=await r.json().catch(()=>null) as {error?:{code?:string;message?:string}}|null;
 if(!r.ok)throw new ApiError(data?.error?.code??"NETWORK",data?.error?.message??"服务暂时无法响应，请重试。");
 return data as T;
}
export const STATUS:Record<string,string>={awaiting_approval:"待确认",running:"执行中",paused:"已暂停",failed:"执行失败",completed:"已完成",stopped:"已停止"};
export const QUALITY:Record<string,string>={valid:"有效",missing:"缺失",stale:"过期",conflict:"冲突"};
export const REASONS:Record<string,string>={user_requested:"用户停止",user_paused:"用户暂停",approval_denied:"计划已拒绝",transient_failure:"暂时性接口失败，可重试",permanent_failure:"接口或参数异常，需新建研究",retry_limit:"重试次数已用尽",tool_limit:"工具调用预算已用尽",model_limit:"模型调用预算已用尽",cost_limit:"模型费用预算已用尽",runtime_limit:"运行时长已用尽",report_budget_exhausted:"报告阶段预算已用尽",model_failure:"模型输出待重新核验",planning_failure:"规划失败，请重试规划",lease_expired:"上次执行未完成，请恢复检查点"};
export function dateLabel(value:string|null|undefined){if(!value)return "待核验";const d=new Date(value);return Number.isNaN(d.getTime())?"待核验":new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(d)}
export function symbolName(symbol:string){return {"600519.SH":"贵州茅台","000858.SZ":"五粮液","000568.SZ":"泸州老窖"}[symbol]??symbol}
