import fs from "node:fs";
import path from "node:path";
import { executeTool, discoverMcp } from "../lib/buddy/providers.ts";
const destination=path.resolve(".cache/live-probes");
fs.mkdirSync(destination,{recursive:true});
const config={FUYAO_API_KEY:process.env.FUYAO_API_KEY,IFIND_API_KEY:process.env.IFIND_API_KEY,IFIND_MCP_BASE_URL:process.env.IFIND_MCP_BASE_URL};
const outcomes=[];
for(const name of ["fuyao_search","fuyao_quote","fuyao_history","fuyao_income","fuyao_balance","fuyao_cashflow","fuyao_valuation","fuyao_calendar","ifind_company","ifind_notice","ifind_news"]){
 const at=new Date().toISOString(),start=Date.now();
 try{const e=await executeTool(name,name==="fuyao_search"?{query:"600519.SH"}:name==="ifind_company"?{query:"贵州茅台 600519.SH 公司基本信息"}:name==="ifind_news"||name==="ifind_notice"?{query:"600519.SH 贵州茅台 现金流 经营数据",size:2,time_start:"2026-07-04",time_end:"2026-10-02"}:name==="fuyao_calendar"?{}:{symbol:"600519.SH"},config,{id:"probe-"+name,now:at});fs.writeFileSync(path.join(destination,name+".json"),JSON.stringify(e,null,2));outcomes.push({tool:name,status:"success",quality:e.quality,asOf:e.asOf,scope:e.scope,metrics:e.metrics?.map(m=>({key:m.key,value:m.value,unit:m.unit,period:m.period})),summary:e.provider==="iFinD MCP"?e.summary.slice(0,160):e.summary,elapsedMs:Date.now()-start});}
 catch(error){outcomes.push({tool:name,status:"failed",code:error.code??"UNKNOWN",message:error.code?error.message:"未完成",elapsedMs:Date.now()-start})}
}
try{const schemas=await discoverMcp(config);fs.writeFileSync(path.join(destination,"mcp-schemas.json"),JSON.stringify(schemas,null,2));outcomes.push({tool:"mcp_discovery",status:"success",servers:schemas.map(s=>({server:s.server,count:s.tools.length,selected:s.tools.filter(t=>["search_news","search_notice","get_stock_info"].includes(t.name))}))})}catch(error){outcomes.push({tool:"mcp_discovery",status:"failed",code:error.code??"UNKNOWN"})}
fs.writeFileSync(path.join(destination,"outcomes.json"),JSON.stringify({at:new Date().toISOString(),outcomes},null,2));
console.log(JSON.stringify(outcomes,null,2));
if(outcomes.some(o=>o.status!=="success"))process.exitCode=1;
