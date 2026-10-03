import type {AgentRun,ResearchReport,ResearchClaim} from "./types.ts";
import {compareFinancials} from "./data.ts";import type {EvidenceReview} from "./model.ts";
function rawAt(raw:unknown,path:string):unknown{let value=raw;for(const p of path.split(".")){if(!value||typeof value!=="object"||["__proto__","constructor","prototype"].includes(p)||!Object.hasOwn(value,p))return undefined;value=(value as Record<string,unknown>)[p]}return value}
export function runSymbols(run:AgentRun):string[]{return [...new Set(run.plan.map(t=>t.arguments.symbol).filter((s):s is string=>typeof s==="string"))]}
export function buildResearchReport(run:AgentRun,review?:EvidenceReview):ResearchReport{
 const symbols=runSymbols(run),comparison=compareFinancials(run.evidence,symbols),claims:ResearchClaim[]=[];
 const preferred=new Set(["operating_income","net_profit","act_cash_flow_net","pe_ttm"]);
 for(const e of run.evidence){
  if(e.quality!=="valid"||!e.asOf)continue;
  const latest=e.metrics?.find(m=>m.period)?.period;
  for(const m of e.metrics??[]){
   if(!preferred.has(m.key)||m.value===null||!m.fieldPath||(m.period&&m.period!==(comparison.period??latest)))continue;
   const value=rawAt(e.raw,m.fieldPath);if(typeof value!=="number"&&typeof value!=="string")continue;
   claims.push({id:"c"+(claims.length+1),kind:"fact",text:(e.symbol??e.title)+" 的"+m.label+"为 "+String(value)+" "+m.unit+"。",evidenceIds:[e.id],verification:{evidenceId:e.id,fieldPath:m.fieldPath,value,unit:m.unit}});
  }
 }
 for(const row of comparison.rows)if(row.cashConversion!==null)claims.push({id:"c"+(claims.length+1),kind:"inference",text:row.symbol+" 的经营现金流/合并净利润为 "+row.cashConversion.toFixed(2)+" 倍（代码计算：经营现金流净额 ÷ 合并净利润）；该比值只提示利润现金支持情况，仍需核验经营周期。",evidenceIds:row.evidenceIds});
 for(const issue of comparison.issues)claims.push({id:"c"+(claims.length+1),kind:"unknown",text:issue,evidenceIds:[]});
 for(const e of run.evidence.filter(e=>e.quality!=="valid"))claims.push({id:"c"+(claims.length+1),kind:"unknown",text:e.title+"："+e.summary+"，暂不作为已核验事实。",evidenceIds:[e.id]});
 for(const claim of review?.claims??[])claims.push({id:"c"+(claims.length+1),...claim});
 const demo=run.mode==="demo";
 const coverage=run.evidence.filter(e=>e.summary.includes("历史覆盖不足")).map(e=>e.title+"："+e.summary);
 const limitations=[...(demo?["全部金融数值和文本为构造数据，仅用于工作流演示，不能用于实际投资判断。"]:["供应商数据已进行字段、单位与引用校验，尚未与原始披露做独立二次交叉核验。"]),...coverage,"财务比较使用"+(comparison.period??"各自最新年度")+"年度累计，未作为单季度数据；合并净利润与归母净利润分开。","估值为快照响应时点；未提供独立交易时间，不能视为当日成交价格。","模型文字属于研究推断，不构成确定收益或价格判断。",...(review?.limitations??[])];
 return {title:run.title+" · 研究报告",summary:review?.summary??(demo?"构造数据研究演示已完成：事实、代码计算的研究推断与未知分别呈现；未调用外部模型。":"已抽取有原始字段支撑的财务事实与代码计算结果。请结合数据时点、口径和待验证问题阅读。"),claims,limitations:limitations.slice(0,30),questions:review?.questions??["现金流与净利润差异，是否来自营运资本变动？","同业估值差异是否与增长、资产质量或经营周期相关？","正式公告与供应商字段是否一致？"],generatedAt:run.updatedAt};
}
