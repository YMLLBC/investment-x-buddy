import type { Evidence, FinancialMetric } from "./types.ts";
export type FuyaoKind="quote"|"history"|"income"|"balance"|"cashflow"|"valuation"|"search"|"calendar";
export interface NormalizeOptions{id:string;symbol?:string;retrievedAt:string;sourceUrl:string}
// Compare decimal spellings after removing formatting-only zeros/exponents. This
// catches decimal-string rounding/underflow without rejecting ordinary decimals.
function decimal(value:string):string{
 const parts=/^([+-]?)(\d*\.?\d*)(?:[eE]([+-]?\d+))?$/.exec(value)!;
 const fraction=parts[2].split(".")[1]?.length??0;
 let digits=parts[2].replace(".","").replace(/^0+/,"");if(!digits)return "0";
 const trailing=digits.length-digits.replace(/0+$/,"").length;digits=digits.slice(0,digits.length-trailing);
 return (parts[1]==="-"?"-":"")+digits+"e"+(Number(parts[3]??0)-fraction+trailing);
}
export function numeric(value:unknown):number|null{
 if(typeof value==="string"){
  const original=value.trim();if(!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(original))return null;
  const parsed=Number(original);if(!Number.isFinite(parsed)||Math.abs(parsed)>Number.MAX_SAFE_INTEGER||decimal(original)!==decimal(String(parsed)))return null;return parsed;
 }
 return typeof value==="number"&&Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER?value:null;
}
function obj(value:unknown):Record<string,unknown>{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{}}
function time(value:unknown):string|null{const n=numeric(value);if(n===null||n<Date.parse("2000-01-01")||n>Date.parse("2100-01-01"))return null;try{return new Date(n).toISOString()}catch{return null}}
export async function sha256(value:unknown):Promise<string>{const buffer=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(value)));return Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,"0")).join("")}
const definitions:Record<FuyaoKind,[string,string,string][]> ={
 quote:[["last_price","最新价","CNY 元/股"],["price_change_ratio_pct","涨跌幅","%"]],
 valuation:[["pe_ttm","市盈率 TTM","倍"],["pb_mrq","市净率 MRQ","倍"],["ps_ttm","市销率 TTM","倍"],["pcf_ttm","市现率 TTM","倍"]],
 income:[["operating_income","营业收入","CNY 元"],["net_profit","合并净利润","CNY 元"],["parent_holder_net_profit","归母净利润","CNY 元"],["operating_profit","营业利润","CNY 元"]],
 cashflow:[["act_cash_flow_net","经营活动现金流净额","CNY 元"],["pay_fixed_assets_etc_cash","购建长期资产支付现金","CNY 元"],["invest_cash_flow_net","投资现金流净额","CNY 元"]],
 balance:[["assets_total","资产总计","CNY 元"],["total_debt","负债合计（供应商字段）","CNY 元"],["cash","货币资金","CNY 元"],["holder_equity_total","所有者权益合计","CNY 元"]],
 history:[],search:[],calendar:[]
};
const titles:Record<FuyaoKind,string>={quote:"行情快照",history:"历史价格",income:"利润表",cashflow:"现金流量表",balance:"资产负债表",valuation:"估值快照",search:"证券代码校验",calendar:"交易日历"};
export async function normalizeFuyao(kind:FuyaoKind,raw:unknown,options:NormalizeOptions):Promise<Evidence>{
 const source=obj(raw),data=obj(source.data),items=Array.isArray(data.item)?data.item.map(obj):[];
 const financial=["income","balance","cashflow"].includes(kind),market=["quote","valuation"].includes(kind);
 const metrics:FinancialMetric[]=[],series:{date:string;value:number|null}[]=[];
 let quality:Evidence["quality"]="valid",asOf:string|null=null;
 const indices=items.map((r,i)=>({r,i})).filter(({r})=>kind==="calendar"||!options.symbol||r.thscode===options.symbol||(kind==="history"&&!r.thscode));
 if(!items.length)quality="missing";else if(!indices.length)quality="conflict";
 const periods:string[]=[],coverage=new Set<string>(),conflicts=new Set<string>();
 for(const {r,i} of indices){
  let period:string|undefined,validAnnual=false;
  if(financial){
   const year=numeric(r.fiscal_year),end=time(r.period_end_ms);
   const annual=r.currency==="CNY"&&r.period==="annual"&&r.fiscal_period==="FY";
   if(!annual)quality="conflict";
   if(year===null||!end){if(quality==="valid")quality="missing";}
   else{
    // Fuyao A-share FY uses mainland China calendar years (UTC+08:00).
    // Keep asOf in UTC, but validate its local calendar date to avoid a
    // valid Dec 31 midnight being misread as Dec 30 in UTC.
    const local=new Date(Date.parse(end)+8*3600000);
    if(!Number.isInteger(year)||year<2000||year>2099||local.getUTCFullYear()!==year||local.getUTCMonth()!==11||local.getUTCDate()!==31){quality="conflict";conflicts.add("财年与境内年度期末日期冲突")}
    else{period=String(year)+"-FY";periods.push(period);if(!asOf||end>asOf)asOf=end;validAnnual=annual;}
   }
  }
  let safeRow=true,hasValue=false;
  for(const [key,label,unit] of definitions[kind]){
   const value=numeric(r[key]);if(value===null&&r[key]!==undefined&&r[key]!==null){safeRow=false;quality="conflict";conflicts.add("数值格式、范围或精度不安全（data.item."+i+"."+key+"）")}if(value!==null)hasValue=true;
   metrics.push({key,label,unit,value,fieldPath:"data.item."+i+"."+key,...(period?{period}:{}),...(options.symbol?{symbol:options.symbol}:{})});
  }
  if(validAnnual&&period&&safeRow&&hasValue)coverage.add(period);
  if(kind==="history"){const date=time(r.date_ms);if(date){series.push({date,value:numeric(r.close_price)});if(!asOf||date>asOf)asOf=date}}
  if(kind==="calendar"){const date=time(r.date_ms);if(date&&(!asOf||date>asOf))asOf=date}
 }
 if(market||kind==="search")asOf=time(data.timestamp);
 if((market||financial||kind==="history")&&quality==="valid"&&(!asOf||(!metrics.some(m=>m.value!==null)&&!series.some(p=>p.value!==null))))quality="missing";
 if(quality==="valid"&&asOf){const age=Date.parse(options.retrievedAt)-Date.parse(asOf);if(age< -86400000)quality="conflict";else if(age>(financial?550:kind==="history"?30:7)*86400000&&kind!=="search"&&kind!=="calendar")quality="stale";}
 const scope=financial?"年度累计 · "+[...new Set(periods)].join(" / ")+" · CNY；不作单季解释；不同有效年度覆盖 "+coverage.size+"/3":market?"快照响应时点；未提供独立交易时点":kind==="history"?"日线 · 前复权 · CNY 元/股":kind==="calendar"?"A 股交易日历":"证券身份匹配";
 const missing=metrics.filter(m=>m.value===null).length;
 const summary=(quality==="missing"?"数据或日期字段缺失":quality==="conflict"?"证券身份、币种、财报口径或日期冲突":quality==="stale"?"数据时点超过本工作台有效期，需重新核验":titles[kind]+"已获取"+(missing?"；"+missing+"个字段缺失":""))+(conflicts.size?"；"+[...conflicts].join("；"):"")+(financial?coverage.size<3?"；仅覆盖"+coverage.size+"个不同有效年度，历史覆盖不足3年度要求":"；已覆盖"+coverage.size+"个不同有效年度":"");
 return {id:options.id,title:(options.symbol?options.symbol+" · ":"")+titles[kind],provider:"扶摇",sourceUrl:options.sourceUrl,retrievedAt:options.retrievedAt,asOf,unit:financial?"CNY 元":kind==="history"?"CNY 元/股":market?"混合单位（见字段）":"文本",scope,quality,summary,raw:structuredClone(raw),hash:await sha256(raw),metrics,series:series.sort((a,b)=>a.date.localeCompare(b.date)),...(options.symbol?{symbol:options.symbol}:{})};
}
export interface FinancialComparison{period:string|null;rows:{symbol:string;revenue:number|null;netProfit:number|null;cashflow:number|null;cashConversion:number|null;netMarginPct:number|null;evidenceIds:string[]}[];issues:string[]}
export function compareFinancials(evidence:Evidence[],symbols:string[]):FinancialComparison{
 const eligible=evidence.filter(e=>e.quality==="valid");
 function metrics(symbol:string,key:string,period?:string){return eligible.filter(e=>e.symbol===symbol).flatMap(e=>(e.metrics??[]).filter(m=>m.key===key&&m.unit==="CNY 元"&&/^\d{4}-FY$/.test(m.period??"")&&(!period||m.period===period)).map(m=>({e,m})));}
 function available(symbol:string,key:string,period:string){return metrics(symbol,key,period).some(({m})=>numeric(m.value)!==null)}
 const periods=symbols.map(symbol=>new Set(metrics(symbol,"operating_income").filter(({m})=>numeric(m.value)!==null).map(({m})=>m.period!)));
 const common=[...(periods[0]??[])].filter(p=>periods.every(s=>s.has(p))).sort().reverse();
 const latest=common[0]??null,complete=common.find(p=>symbols.every(s=>["operating_income","net_profit","act_cash_flow_net"].every(key=>available(s,key,p))));
 const period=complete??latest,issues:string[]=[];
 if(!period)issues.push("未找到全部公司共同的有效年度报告期，停止财务横向比较。");
 if(latest&&period&&period!==latest){
  const missing=symbols.flatMap(s=>[["operating_income","收入"],["net_profit","合并净利润"],["act_cash_flow_net","现金流"]].filter(([key])=>!available(s,key,latest)).map(([,label])=>s+" 的"+label));
  issues.push("最新共同收入年度 "+latest+" 缺失"+missing.join("、")+"；回退到完整共同财务年度 "+period+" 比较，不能将旧期视为最新期。");
 }
 const rows=symbols.map(symbol=>{
  const ids=new Set<string>();function value(key:string){const found=metrics(symbol,key,period!).find(({m})=>numeric(m.value)!==null);if(!found)return null;ids.add(found.e.id);return found.m.value}
  const revenue=period?value("operating_income"):null,netProfit=period?value("net_profit"):null,cashflow=period?value("act_cash_flow_net"):null;
  if(period&&(revenue===null||netProfit===null||cashflow===null))issues.push(symbol+"："+period+" 的收入、合并净利润或现金流存在缺失。");
  if(netProfit!==null&&netProfit<=0)issues.push(symbol+"：净利润非正，现金流/净利润不适合直接比较。");
  function derived(value:number|null,label:string){if(value!==null&&!Number.isFinite(value)){issues.push(symbol+"："+period+" 的"+label+"计算溢出或不是有限数，结果未知。");return null}return value}
  return {symbol,revenue,netProfit,cashflow,cashConversion:derived(cashflow!==null&&netProfit!==null&&netProfit>0?cashflow/netProfit:null,"现金流/合并净利润"),netMarginPct:derived(revenue!==null&&revenue>0&&netProfit!==null?100*netProfit/revenue:null,"净利率"),evidenceIds:[...ids]};
 });
 return {period,rows,issues};
}
