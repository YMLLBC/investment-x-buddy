import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFuyao, compareFinancials, numeric } from "../lib/buddy/data.ts";
const at="2026-10-02T10:00:00.000Z", symbol="600519.SH";
const opts={id:"e1",symbol,retrievedAt:at,sourceUrl:"https://fuyao.aicubes.cn/api/a-share/financials/income-statements"};
const row={thscode:symbol,currency:"CNY",period:"annual",fiscal_year:2025,fiscal_period:"FY",period_end_ms:Date.parse("2025-12-31T00:00:00+08:00"),report_date_ms:Date.parse("2026-03-28T00:00:00+08:00"),operating_income:100,net_profit:0,parent_holder_net_profit:null};
test("numeric preserves zero and rejects absent, malformed and nonfinite values",()=>{assert.equal(numeric(0),0);assert.equal(numeric("0"),0);for(const v of [null,undefined,"","--","1,000",Infinity,"0oops",true])assert.equal(numeric(v),null)});
test("financial evidence preserves raw fields, yuan units and fiscal period instead of response time",async()=>{const raw={code:0,data:{timestamp:Date.parse(at),item:[row]}};const e=await normalizeFuyao("income",raw,opts);assert.deepEqual(e.raw,raw);assert.equal(e.asOf,new Date(row.period_end_ms).toISOString());assert.equal(e.metrics?.find(m=>m.key==="net_profit")?.value,0);assert.equal(e.metrics?.find(m=>m.key==="parent_holder_net_profit")?.value,null);assert.equal(e.metrics?.[0].unit,"CNY 元");assert.equal(e.metrics?.[0].period,"2025-FY");assert.equal(e.metrics?.[0].fieldPath,"data.item.0.operating_income");assert.match(e.hash,/^[a-f0-9]{64}$/)});
test("foreign symbol or currency is never accepted as comparable financial evidence",async()=>{for(const bad of [{...row,thscode:"000858.SZ"},{...row,currency:"USD"}]){const e=await normalizeFuyao("income",{code:0,data:{item:[bad]}},opts);assert.equal(e.quality,"conflict")}});
test("empty data and stale snapshots are distinguished",async()=>{const empty=await normalizeFuyao("income",{code:0,data:{item:[]}},opts);assert.equal(empty.quality,"missing");const e=await normalizeFuyao("valuation",{code:0,data:{timestamp:Date.parse("2025-01-01"),item:[{thscode:symbol,pe_ttm:24,pb_mrq:8}]}},opts);assert.equal(e.quality,"stale")});
test("snapshot percentage already in percent is not multiplied and date scope stays explicit",async()=>{const e=await normalizeFuyao("quote",{code:0,data:{timestamp:Date.parse(at),item:[{thscode:symbol,last_price:12,price_change_ratio_pct:2.5}]}},opts);assert.equal(e.metrics?.find(m=>m.key==="price_change_ratio_pct")?.value,2.5);assert.equal(e.metrics?.find(m=>m.key==="price_change_ratio_pct")?.unit,"%");assert.match(e.scope,/响应时点/);assert.match(e.scope,/交易时点/)});
test("financial comparison only uses common annual periods and keeps missing and zero denominator explicit",async()=>{const es=[];for(const s of ["600519.SH","000858.SZ"]){es.push(await normalizeFuyao("income",{code:0,data:{item:[{...row,thscode:s,net_profit:s===symbol?0:20}]}},{...opts,id:s+"i",symbol:s}));es.push(await normalizeFuyao("cashflow",{code:0,data:{item:[{...row,thscode:s,act_cash_flow_net:30}]}},{...opts,id:s+"c",symbol:s}));}const c=compareFinancials(es,["600519.SH","000858.SZ"]);assert.equal(c.period,"2025-FY");assert.equal(c.rows[0].cashConversion,null);assert.equal(c.rows[1].cashConversion,1.5);assert.equal(c.rows[1].netMarginPct,20);assert.equal(c.rows[0].revenue,100);const mixed=await normalizeFuyao("income",{code:0,data:{item:[{...row,thscode:"000858.SZ",fiscal_year:2024,period_end_ms:Date.parse("2024-12-31")}]}},{...opts,id:"mixed",symbol:"000858.SZ"});assert.equal(compareFinancials([es[0],mixed],["600519.SH","000858.SZ"]).period,null)});

test("numeric rejects unsafe range, silently rounded strings and underflow while accepting safe decimals",()=>{
 for(const value of [9007199254740992,-9007199254740992,"9007199254740993","9007199254740990.5","0.10000000000000001",1e308,"1e-999"])assert.equal(numeric(value),null,String(value));
 for(const [input,want] of [["9007199254740991",9007199254740991],["-9007199254740991",-9007199254740991],["0001.2500e+2",125],["0.1",0.1],["1e-300",1e-300]] as const)assert.equal(numeric(input),want);
});
test("unsafe financial values fail closed without changing raw fields, order or hash",async()=>{
 const raw={code:0,data:{item:[{...row,operating_income:"9007199254740993",net_profit:20}]}};
 const original=JSON.stringify(raw),e=await normalizeFuyao("income",raw,opts);
 assert.equal(e.quality,"conflict");assert.equal(e.metrics?.find(m=>m.key==="operating_income")?.value,null);assert.equal(e.metrics?.[0].fieldPath,"data.item.0.operating_income");assert.equal(JSON.stringify(e.raw),original);assert.equal(JSON.stringify(raw),original);
 const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(original));assert.equal(e.hash,Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join(""));assert.match(e.summary,/数值|安全/);
});
test("financial year and annual end must agree in mainland reporting timezone",async()=>{
 for(const bad of [{...row,fiscal_year:2026},{...row,period_end_ms:Date.parse("2025-06-30T00:00:00+08:00")},{...row,fiscal_year:2025.5}]){
  const e=await normalizeFuyao("income",{data:{item:[bad]}},opts);assert.equal(e.quality,"conflict");assert.equal(compareFinancials([e],[symbol]).period,null);
 }
 for(const end of ["2025-12-31T00:00:00+08:00","2025-12-31T00:00:00Z"]){const e=await normalizeFuyao("income",{data:{item:[{...row,period_end_ms:Date.parse(end)}]}},opts);assert.equal(e.quality,"valid");assert.equal(e.metrics?.[0].period,"2025-FY")}
});
test("annual coverage counts distinct usable years and preserves valid single-year facts",async()=>{
 const make=(year:number)=>({...row,fiscal_year:year,period_end_ms:Date.parse(year+"-12-31T00:00:00+08:00")});
 const one=await normalizeFuyao("income",{data:{item:[make(2025),make(2025)]}},opts);assert.equal(one.quality,"valid");assert.equal(one.metrics?.length,8);assert.match(one.summary,/仅覆盖1个.*年度.*不足3/);
 const two=await normalizeFuyao("income",{data:{item:[make(2025),make(2024),make(2024)]}},opts);assert.equal(two.quality,"valid");assert.match(two.summary,/仅覆盖2个.*年度.*不足3/);
 const three=await normalizeFuyao("income",{data:{item:[make(2025),make(2024),make(2023)]}},opts);assert.equal(three.quality,"valid");assert.doesNotMatch(three.summary,/不足3/);
});
test("annual coverage excludes rows with unsafe values and wholly missing financial metrics",async()=>{
 const make=(year:number)=>({...row,fiscal_year:year,period_end_ms:Date.parse(year+"-12-31T00:00:00+08:00")});
 const e=await normalizeFuyao("income",{data:{item:[make(2025),{...make(2024),operating_income:"9007199254740993"},{...make(2023),operating_income:null,net_profit:null}]}},opts);
 assert.equal(e.quality,"conflict");assert.match(e.scope,/不同有效年度覆盖 1\/3/);assert.match(e.summary,/仅覆盖1个.*年度.*不足3/);
});
async function comparisonEvidence(cashYears:number[],missing=false){
 const evidence=[];for(const s of [symbol,"000858.SZ"]){const make=(year:number)=>({...row,thscode:s,fiscal_year:year,period_end_ms:Date.parse(year+"-12-31T00:00:00+08:00"),net_profit:20,act_cash_flow_net:missing?null:30});
  evidence.push(await normalizeFuyao("income",{data:{item:[make(2025),make(2024)]}},{...opts,id:s+"i",symbol:s,retrievedAt:"2026-04-02T12:00:00.000Z"}));evidence.push(await normalizeFuyao("cashflow",{data:{item:cashYears.map(make)}},{...opts,id:s+"c",symbol:s,retrievedAt:"2026-04-02T12:00:00.000Z"}));
 }return evidence;
}
test("comparison chooses complete common year and discloses missing newest CFO when falling back",async()=>{
 const c=compareFinancials(await comparisonEvidence([2024]),[symbol,"000858.SZ"]);assert.equal(c.period,"2024-FY");for(const r of c.rows){assert.equal(r.cashflow,30);assert.equal(r.cashConversion,1.5)}assert.ok(c.issues.some(i=>i.includes("2025-FY")&&i.includes("现金流")&&i.includes("2024-FY")));
 const latest=compareFinancials(await comparisonEvidence([2025,2024]),[symbol,"000858.SZ"]);assert.equal(latest.period,"2025-FY");assert.equal(latest.issues.length,0);
});
test("comparison retains latest shared year and null when every shared year is incomplete",async()=>{
 const c=compareFinancials(await comparisonEvidence([2025,2024],true),[symbol,"000858.SZ"]);assert.equal(c.period,"2025-FY");for(const r of c.rows){assert.equal(r.revenue,100);assert.equal(r.cashflow,null);assert.equal(r.cashConversion,null)}assert.ok(c.issues.some(i=>i.includes("2025-FY")&&i.includes("缺失")));
});
test("derived financial ratios overflow to unknown rather than Infinity",async()=>{
 const income=await normalizeFuyao("income",{data:{item:[{...row,operating_income:1e-300,net_profit:1e-300}]}},opts),cash=await normalizeFuyao("cashflow",{data:{item:[{...row,act_cash_flow_net:9007199254740991}]}},{...opts,id:"cash"});
 const c=compareFinancials([income,cash],[symbol]);assert.equal(c.rows[0].cashConversion,null);assert.ok(c.issues.some(i=>i.includes(symbol)&&/计算|有限|溢出/.test(i)));
 const margin=await normalizeFuyao("income",{data:{item:[{...row,operating_income:1e-300,net_profit:9007199254740991}]}},opts);const m=compareFinancials([margin,cash],[symbol]);assert.equal(m.rows[0].netMarginPct,null);assert.ok(m.issues.some(i=>/净利率/.test(i)));
});
