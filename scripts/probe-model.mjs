import fs from "node:fs";import {callModel,planningPayload,parsePlanResponse,modelReservation} from "../lib/buddy/model.ts";import {curatedTools} from "../lib/buddy/providers.ts";
const config=process.env,goal="比较贵州茅台、五粮液、泸州老窖的盈利质量和估值，核验现金流与利润的差异，保留待验证问题。",symbols=["600519.SH","000858.SZ","000568.SZ"],tools=curatedTools();
const payload=planningPayload(goal,symbols,tools,[],new Date().toISOString(),config),reservation=modelReservation(payload,3000,config);
if(reservation>0.05)throw new Error("Probe budget exceeded");
const start=Date.now();const result=await callModel(payload,config);
fs.mkdirSync(".cache/live-probes",{recursive:true});fs.writeFileSync(".cache/live-probes/model-planning.json",JSON.stringify(result,null,2));
const plan=parsePlanResponse(result.raw,tools,symbols);
fs.writeFileSync(".cache/live-probes/validated-plan.json",JSON.stringify({at:new Date().toISOString(),plan,usage:result.usage},null,2));
console.log(JSON.stringify({status:"validated",reservationUsd:reservation,elapsedMs:Date.now()-start,title:plan.title,taskCount:plan.tasks.length,tasks:plan.tasks.map(t=>({title:t.title,tool:t.tool,arguments:t.arguments})),usage:result.usage},null,2));
