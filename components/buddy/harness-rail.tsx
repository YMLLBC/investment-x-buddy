"use client";
import {Check,GitBranch,Terminal,Clock3,Database,Link2} from "lucide-react";
import {Progress} from "@/components/ui/progress";
import type {RunView,Bootstrap} from "@/lib/buddy/client";import {dateLabel} from "@/lib/buddy/client";
const TYPES:Record<string,string>={task_started:"调用工具",task_completed:"证据已保存",task_failed:"调用失败",approved:"用户确认计划",approval_denied:"用户拒绝计划",resumed:"恢复检查点",stopped:"用户停止",user_paused:"用户暂停",budget_paused:"预算暂停",model_usage:"模型用量",context_compressed:"压缩上下文",completed:"报告验证通过",planning_started:"模型规划",planning_completed:"计划已生成",planning_failed:"规划失败",review_started:"模型解读",review_failed:"解读失败",created:"研究已创建",usage_settled:"费用结算",paused:"用户暂停"};
export function HarnessRail({view,bootstrap}:{view:RunView|null;bootstrap:Bootstrap|null}){
 const run=view?.run,limits=run?.limits??bootstrap?.limits??{maxToolCalls:24,maxModelCalls:4,maxEstimatedUsd:.5,maxRuntimeMs:900000},m=run?.metrics;
 return <aside className="right-column"><div className="rail-heading"><Terminal size={16}/><span>AGENT HARNESS</span><span className="rail-live">{view?.executing?"BUSY":run?.status==="running"?"RUNNING":"READY"}</span></div>
 <section className="rail-card"><div className="rail-caption">运行边界与用量</div><h3>{run?"每一次调用，\n都留下记录。":"让自主执行\n保持可控。"}</h3>
 <div className="boundary-row"><span>工具调用</span><b>{m?.toolCalls??0}<small> / {limits.maxToolCalls}</small></b></div><Progress aria-label="工具调用预算" value={limits.maxToolCalls?100*(m?.toolCalls??0)/limits.maxToolCalls:0}/>
 <div className="boundary-row"><span>模型调用</span><b>{m?.modelCalls??0}<small> / {limits.maxModelCalls}</small></b></div>
 <div className="boundary-row"><span>估算模型费用</span><b>${(m?.estimatedUsd??0).toFixed(4)}</b></div><small className="budget-cap">预算 ${limits.maxEstimatedUsd.toFixed(2)} · 15 分钟</small>
 <div className="token-strip"><span>输入 {m?.inputTokens??0}</span><span>输出 {m?.outputTokens??0}</span></div>
 <p className="rail-fine">费用按返回用量估算；用量未知时保留预留费用。金融数据工具计费以供应商账户为准。</p>
 {bootstrap?.dailyBudget&&<p className="rail-fine">全站今日模型预算（UTC）：${(bootstrap.dailyBudget.spent+bootstrap.dailyBudget.reserved).toFixed(3)} / ${bootstrap.dailyBudget.cap}</p>}</section>
 {run?<><section className="checkpoint-card"><div className="rail-caption"><Database size={13}/> 持久检查点</div><strong>{run.checkpoint.completedTaskIds.length} / {run.plan.length} 步已保存</strong><p>{dateLabel(run.checkpoint.savedAt)} · 版本 {run.version}</p><span>{run.contextSummary?"上下文已整理，原始证据完整保留":"研究目标与用户记忆保持绑定"}</span></section>
 <section className="trace"><div className="rail-caption"><Clock3 size={13}/> 运行轨迹 <span>{run.events.length}</span></div><div className="trace-list" aria-live="polite">{[...run.events].reverse().slice(0,12).map(e=><div key={e.id}><i className={e.type.includes("fail")?"fail":""}/><strong>{TYPES[e.type]??"研究状态更新"}</strong><time>{dateLabel(e.at)}</time><p>{e.details?.taskId?run.plan.find(t=>t.id===e.details?.taskId)?.title:e.message.startsWith("Run")||e.message.startsWith("Plan")||e.message.startsWith("Task")||e.message.startsWith("Research")||e.message.startsWith("Deterministic")?"检查点已同步":e.message}</p></div>)}</div></section></>:<><div className="evidence-principles"><div className="rail-caption">证据标准</div>{["来源与数据时点","原始字段与单位","引用与计算可复核"].map(s=><div key={s}><Check size={14}/>{s}</div>)}</div><div className="rail-bottom"><GitBranch size={21}/><p>研究过程是资产。<br/>每次执行都有检查点。</p><Link2 size={14}/></div></>}
 </aside>;
}
