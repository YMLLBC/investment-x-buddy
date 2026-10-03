import fs from "node:fs/promises";import path from "node:path";import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url));process.chdir(root);
process.loadEnvFile(".env.local");const config=process.env;
if(!config.RESEARCH_ACCESS_CODE)throw new Error("Private access configuration missing");
const base=process.env.BUDDY_BASE_URL??"http://127.0.0.1:5173";let cookie="";
async function request(route,body,mode="live"){
 const res=await fetch(base+"/api/buddy/"+route+(route.includes("?")?"&":"?")+"mode="+mode,{method:body===undefined?"GET":"POST",headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{"Content-Type":"application/json","X-Buddy-Client":"workbench"})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(180000)});
 const setCookie=res.headers.get("set-cookie");if(setCookie)cookie=setCookie.split(";")[0];const result=await res.json().catch(()=>null);
 if(!res.ok){const code=String(result?.error?.code??"UNKNOWN").replace(/[^A-Z_]/g,"").slice(0,60);throw new Error("API_"+res.status+"_"+code)}return result;
}
const directory=path.resolve(".cache/live-research");await fs.mkdir(directory,{recursive:true});
await request("bootstrap",undefined,"demo");await request("session",{accessCode:config.RESEARCH_ACCESS_CODE},"demo");
const id=crypto.randomUUID(),symbols=["600519.SH"];
let view=await request("runs",{requestId:id,goal:"研究600519.SH的年度盈利质量、经营现金流与估值口径，查询公司资料及相关公告，列出需要进一步验证的问题。",symbols,scenario:"normal"});
const started=Date.now();let attempts=0;let pauses=0;
while(attempts++<40){
 console.log(JSON.stringify({id,status:view.run.status,planning:view.planning,steps:view.run.checkpoint.completedTaskIds.length,total:view.run.plan.length,tools:view.run.metrics.toolCalls,models:view.run.metrics.modelCalls,cost:view.run.metrics.estimatedUsd}));
 await fs.writeFile(path.join(directory,"checkpoint.json"),JSON.stringify(view,null,2));
 if(view.run.status==="completed")break;
 if(view.planning||view.run.status==="running"){view=await request("runs/"+id+"/advance",{version:view.run.version});continue}
 if(view.run.status==="awaiting_approval"){view=await request("runs/"+id+"/approve",{version:view.run.version,approved:true});continue}
 if(view.run.status==="paused"&&["transient_failure","lease_expired","model_failure"].includes(view.run.stopReason)&&pauses++<2){
  const delay=Math.max(1000,view.retryAt-Date.now());if(delay>60000)throw new Error("RETRY_AFTER_REQUIRES_LATER_RESUME");await new Promise(r=>setTimeout(r,delay));view=await request("runs/"+id+"/resume",{version:view.run.version});continue;
 }
 throw new Error("RESEARCH_NOT_COMPLETE_"+String(view.run.stopReason??view.run.status).replace(/[^A-Za-z_]/g,""));
}
if(view.run.status!=="completed")throw new Error("RESEARCH_LOOP_BOUND");
const result=await request("runs/"+id+"/export?format=json");await fs.writeFile(path.join(directory,"report.json"),JSON.stringify(result,null,2));
const reread=await request("runs/"+id);if(reread.run.status!=="completed"||reread.run.version!==view.run.version)throw new Error("CHECKPOINT_READBACK_MISMATCH");
const summary={id,status:view.run.status,symbols,completedSteps:view.run.checkpoint.completedTaskIds.length,totalSteps:view.run.plan.length,evidenceCount:view.run.evidence.length,metrics:view.run.metrics,facts:result.report.claims.filter(c=>c.kind==="fact").length,inferences:result.report.claims.filter(c=>c.kind==="inference").length,unknowns:result.report.claims.filter(c=>c.kind==="unknown").length,elapsedMs:Date.now()-started,exportReadback:true};
await fs.writeFile(path.join(directory,"summary.json"),JSON.stringify(summary,null,2));console.log("LIVE_VERIFICATION "+JSON.stringify(summary));
