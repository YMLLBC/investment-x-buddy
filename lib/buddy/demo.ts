import type {AgentTask,Evidence} from "./types.ts";
import {normalizeFuyao,sha256,type FuyaoKind} from "./data.ts";import {ProviderError} from "./providers.ts";
const dataset={"constructed":true,"version":"demo-v1","notice":"全部数值为人为构造，仅用于研究工作流演示，非真实市场或财务数据。","companies":[{"symbol":"600519.SH","name":"贵州茅台","revenue":200000000000,"netProfit":96000000000,"cashflow":108000000000,"price":1500,"pe":24,"pb":8.4},{"symbol":"000858.SZ","name":"五粮液","revenue":110000000000,"netProfit":35000000000,"cashflow":32500000000,"price":128,"pe":18,"pb":4.2},{"symbol":"000568.SZ","name":"泸州老窖","revenue":80000000000,"netProfit":24000000000,"cashflow":18500000000,"price":160,"pe":16,"pb":4.8}]};
const sourceUrl="https://investment-x-buddy-lab.golden-robin-3691.chatgpt.site/demo-dataset.json";
export const DEMO_SYMBOLS=dataset.companies.map(c=>c.symbol);
export function demoPlan(symbols:string[]):AgentTask[]{
 if(!symbols.length||symbols.length>3||symbols.some(s=>!DEMO_SYMBOLS.includes(s)))throw new ProviderError("INVALID_ARGUMENTS","演示仅支持示例中的三家 A 股公司");
 const plan:{title:string;tool:string;arguments:Record<string,unknown>}[]=[];
 for(const s of symbols)plan.push({title:s+" · 核验证券身份",tool:"fuyao_search",arguments:{query:s}});
 for(const kind of ["income","cashflow","valuation","history"])for(const s of symbols)plan.push({title:s+" · "+({income:"年度利润表",cashflow:"年度现金流量表",valuation:"估值快照",history:"前复权日线"}[kind]),tool:"fuyao_"+kind,arguments:{symbol:s}});
 const query=symbols.join(" ")+" 盈利质量与现金流";
 plan.push({title:"公司业务资料",tool:"ifind_company",arguments:{query}},{title:"相关公告核验",tool:"ifind_notice",arguments:{query,size:3,time_start:"2026-07-04",time_end:"2026-10-02"}},{title:"新闻背景检索",tool:"ifind_news",arguments:{query,size:3,time_start:"2026-07-04",time_end:"2026-10-02"}});
 return plan.map((t,i)=>({...t,id:"t"+String(i+1).padStart(2,"0"),status:"pending",attempts:0}));
}
export async function executeDemo(task:AgentTask,scenario:"normal"|"missing"|"failure",now:string):Promise<Evidence>{
 const symbol=String(task.arguments.symbol??task.arguments.query??"");
 if(scenario==="failure"&&task.tool==="fuyao_income"&&symbol==="600519.SH"&&task.attempts===1)throw new ProviderError("DEMO_TIMEOUT","构造场景：接口超时。已保留完成步骤，可恢复重试。",true);
 const company=dataset.companies.find(c=>c.symbol===symbol),id="e-"+task.id;
 if(task.tool.startsWith("ifind_")){
  const summary=task.tool==="ifind_company"?"构造资料：公司业务涉及白酒产品；业务资料需要正式披露核验。":task.tool==="ifind_notice"?"构造公告：现金流变化应与预收款、存货及渠道政策共同核验。":"构造新闻：渠道库存和动销可能影响现金回收；不能据此确定未来盈利。";
  const raw={constructed:true,version:dataset.version,content:[{type:"text",text:summary}]};
  return {id,title:"[构造数据] "+task.title,provider:"iFinD MCP 接口形状（构造演示）",sourceUrl,retrievedAt:now,asOf:null,unit:"文本",scope:"演示文本；未经外部检索",quality:"valid",summary,raw,hash:await sha256(raw)};
 }
 if(!company)throw new ProviderError("DEMO_SCOPE","构造数据未包含该证券");
 const kind=task.tool.replace("fuyao_","") as FuyaoKind;
 const period_end_ms=Date.parse("2025-12-31T00:00:00+08:00");
 const financial={thscode:symbol,ticker:symbol.slice(0,6),currency:"CNY",period:"annual",fiscal_year:2025,fiscal_period:"FY",period_end_ms,report_date_ms:Date.parse("2026-03-28T00:00:00+08:00")};
 let item:unknown[];
 if(kind==="search")item=[{thscode:company.symbol,name:company.name,asset_type:"a-share",currency:"CNY"}];
 else if(kind==="income")item=[{...financial,operating_income:company.revenue,net_profit:company.netProfit,parent_holder_net_profit:company.netProfit*.98,operating_profit:company.netProfit*1.28}];
 else if(kind==="cashflow")item=[{...financial,act_cash_flow_net:scenario==="missing"&&symbol==="000568.SZ"?null:company.cashflow,pay_fixed_assets_etc_cash:company.revenue*.02,invest_cash_flow_net:-company.revenue*.025}];
 else if(kind==="valuation")item=[{thscode:symbol,pe_ttm:company.pe,pb_mrq:company.pb,ps_ttm:company.pe*company.netProfit/company.revenue,pcf_ttm:company.pe*company.netProfit/company.cashflow}];
 else if(kind==="history")item=Array.from({length:30},(_,i)=>{const date_ms=Date.parse(now)-(29-i)*4*86400000;const wave=1+Math.sin(i/3)*.027+(i-15)*.002*(company.pe===24?1:.7);return {date_ms,close_price:Math.round(company.price*wave*100)/100}});
 else throw new ProviderError("UNKNOWN_TOOL","演示未注册该工具");
 const raw={code:0,constructed:true,version:dataset.version,data:{timestamp:Date.parse(now),item}};
 const evidence=await normalizeFuyao(kind,raw,{id,symbol:company.symbol,retrievedAt:now,sourceUrl});
 return {...evidence,title:"[构造数据] "+evidence.title,provider:"扶摇接口形状（构造演示）",scope:"构造数据 · "+evidence.scope,summary:"构造数据演示；"+evidence.summary};
}
