import {planningPayload} from "../lib/buddy/model.ts";import {curatedTools} from "../lib/buddy/providers.ts";import {redactText} from "../lib/buddy/report.ts";
const payload=planningPayload("比较盈利质量",["600519.SH"],curatedTools(),[],new Date().toISOString(),process.env);
const response=await fetch("https://api.deepseek.com/responses",{method:"POST",headers:{"Authorization":"Bearer "+process.env.DEEPSEEK_API_KEY,"Content-Type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)});
const raw=await response.json();const error=raw.error&&typeof raw.error==="object"?raw.error:{};
console.log(JSON.stringify({status:response.status,code:redactText(String(error.code??"")),type:redactText(String(error.type??"")),message:redactText(String(error.message??"")).slice(0,2000)},null,2));
