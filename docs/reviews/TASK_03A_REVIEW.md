# Task03A 限定独立审查

审查日期：2026-10-02（Asia/Shanghai）。

**Spec compliance（规格符合性）：Fail / 未通过。**

**Task quality（任务质量）：Fail / 未通过。**

存在 2 项 P1、3 项 P2 阻断问题。主要风险是错配财年、失真数值进入有效证据或研究结论；不应以已有 21 项测试通过作为本阶段验收完成的依据。

## 范围与证据

先读 `docs/tasks/TASK_03A_DATA_MODEL.md`，对照 `docs/stages/TASK_03A_REPORT.md`、`docs/reviews/TASK_03A_PACKAGE.diff`，仅审查 `lib/buddy/{data,providers,model,demo,research}.ts`、对应 4 个测试文件以及 `public/demo-dataset.json`。当前审查文件与包中新增实现一致，未审后续 UI、服务或存储源码。

已有 21 项测试的通过状态来自任务交接，未重复运行同一套测试。本次在 Node v24.18.1 执行两组新增离线探针，均退出 0；这里退出 0 表示成功复现所述行为，不表示实现满足规格。外部调用全部由内存 fetch 替身替代；未联网、未读取 `.env` 或密钥、未改源码、未提交。

## 阻断问题

### 1. [P1] 不安全数值进入有效证据，计算可溢出为 Infinity

位置：`lib/buddy/data.ts:4-6`、`:36`、`:59`；输出位置：`lib/buddy/research.ts:17`。

触发：财务字段为数值字符串 `9007199254740993`，或合并净利润 `1e-300`、经营现金流 `1e308`。`numeric` 仅检查有限数，将前者舍入成 `9007199254740992`；两个输入均有限，但后续除法返回 Infinity，报告生成“经营现金流/合并净利润为 Infinity 倍”。证据仍标记 valid。

重要性：违反安全 number 范围要求；原始字段事实与计算采用的数值可能不一致，且最终推断不是有效金融比值。

验收标准：超出安全精度/范围的数值保留 raw，但不得进入有效计算；派生结果须再次检查有限性，异常明确标 unknown。下方数值探针应不再出现舍入后的有效金额或 Infinity 报告。

### 2. [P1] 财年与期末错配未识别，错误年度可参与比较

位置：`lib/buddy/data.ts:31-34`。

触发：`fiscal_year:2026` 配合 `period_end_ms` 为 `2025-12-31T00:00:00+08:00`。当前返回 `quality:"valid"`、`period:"2026-FY"`、`asOf:"2025-12-30T16:00:00.000Z"`。只检查年份为整数、期末可解析，没有检查两者一致性和年度期末口径。

重要性：错标年度可被 `compareFinancials` 纳入“共同年度”，使跨期比较看似同口径。

验收标准：按供应商明确的时区和年度财报口径验证财年/期末；错配须标 conflict 并停止参与比较。不得简单以 UTC 日期判断境内财报期末，以免误判正常 `+08:00` 时间戳。

### 3. [P2] “至少 3 年”仅写在请求参数，没有验证覆盖不足

位置：`lib/buddy/providers.ts:73`；`lib/buddy/data.ts:26-45`；演示：`lib/buddy/demo.ts:26-31`。

触发：供应商只返回一条 2025 年年报，当前仍标 valid，摘要仅提示个别字段缺失；未提示年度覆盖不足。`limit=3` 是请求上限，不保证取得 3 个不同年度。演示收入/现金流也都仅构造一个年度。

原要求：“至少 3 年数据”。重要性：未记录历史覆盖完整性；短历史或供应商截断响应会被表现为完整获取。单个合法 FY 的财务数字本身不因此无效，本项不要求把合法单年事实改成无效，也不要求上市不足 3 年的公司停止单期横比。

验收标准：保留所有实际返回年度，记录不同有效年度的覆盖；不足 3 年须在 summary/limitations 中明确披露历史覆盖不足。探针的单年事实可保持有效，但不能只输出“利润表已获取”而不说明只有 1 年历史。演示当前也只有 1 年，应准确披露其构造历史覆盖。

### 4. [P2] 共同年度只取营业收入交集，遗漏完整的共同财务年度

位置：`lib/buddy/data.ts:50-56`。

触发：两家公司收入/利润都有 2025、2024 年，现金流均只有 2024 年且仍有效。当前选择 `2025-FY` 并报告两家公司 CFO 缺失；实际 2024 年具有全部共同收入、合并净利润和 CFO，可以按共同有效年度完成比较。

原要求：“共同有效年度比较收入/合并净利润/CFO”。重要性：当前共同年度仅依据收入，产生可避免的 unknown 并丢失已有完整共同期的现金支持比较。未观察到跨期混算；此项是年度选择和结果完整性缺陷。

验收标准：输出须明确区别最新共同收入年度与完整共同财务年度；如以完整共同 `2024-FY` 作比较，两家公司现金流/合并利润为 1.5，并须明确披露 2025 年 CFO 缺失这一回退原因，不得静默呈现旧年为最新年。当前仅报告 2025 年缺失，未识别存在完整 2024 共同期。是否采用回退比较或只列可用旧期由后续实现明确，本审查不替实现者指定接口或结构。

### 5. [P2] 响应解析未执行完整函数参数 schema 校验

位置：`lib/buddy/model.ts:17-35`、`:38-47`；宣告 schema：`:64`、`:68`。

触发：规划顶层/任务、解读顶层/claim 各加入未声明的 `extra` 字段，`parsePlanResponse` 和 `parseReviewResponse` 仍成功；请求 schema 均声明 `additionalProperties:false`。工具执行参数确有 `validatePlan` 校验，但函数参数外层只提取已知字段。

重要性：与“合法 schema、严格解析”要求不符。当前额外字段被丢弃，未证明因此发生任意执行或权限提升；阻断依据是实际服务端校验缺失，而非假设攻击后果。

验收标准：对规划及解读的完整参数对象按对应 schema 验证，所有层级拒绝额外字段，继续保留现有单函数、completed、证券范围、引用及核心工具覆盖检查。下方额外字段探针应被拒绝。

## 可复现命令与判断标准

在 `D:\projects\THSwork\investment-x-buddy` 的 PowerShell 执行。无外部请求，不写源码或缓存。

```powershell
@'
import { normalizeFuyao, numeric, compareFinancials } from './lib/buddy/data.ts';
import { parsePlanResponse, parseReviewResponse } from './lib/buddy/model.ts';
import { curatedTools } from './lib/buddy/providers.ts';
import { buildResearchReport } from './lib/buddy/research.ts';
const now='2026-10-02T12:00:00.000Z', symbol='600519.SH';
const opts={id:'probe',symbol,retrievedAt:now,sourceUrl:'https://fuyao.aicubes.cn/api/probe'};
const row={thscode:symbol,currency:'CNY',period:'annual',fiscal_year:2025,fiscal_period:'FY',period_end_ms:Date.parse('2025-12-31T00:00:00+08:00'),operating_income:100,net_profit:20};
const raw=item=>({code:0,data:{timestamp:Date.parse(now),item}});
const badYear=await normalizeFuyao('income',raw([{...row,fiscal_year:2026}]),opts);
console.log('fiscalMismatch',badYear.quality,badYear.metrics[0].period,badYear.asOf);
const oneYear=await normalizeFuyao('income',raw([row]),opts);
console.log('oneYear',oneYear.quality,new Set(oneYear.metrics.map(m=>m.period)).size,oneYear.summary);
const unsafe=await normalizeFuyao('income',raw([{...row,operating_income:'9007199254740993',net_profit:1e-300}]),opts);
const cash=await normalizeFuyao('cashflow',raw([{...row,act_cash_flow_net:1e308}]),{...opts,id:'cash'});
const c=compareFinancials([unsafe,cash],[symbol]);
const report=buildResearchReport({plan:[{arguments:{symbol}}],evidence:[unsafe,cash],mode:'live',title:'probe',updatedAt:now});
console.log('unsafeNumber',unsafe.quality,numeric('9007199254740993'),String(c.rows[0].cashConversion),report.claims.find(c=>c.kind==='inference')?.text);
const call=(name,args)=>({status:'completed',output:[{type:'function_call',name,arguments:JSON.stringify(args)}]});
const plan={title:'scope',limitations:[],extra:'unexpected',tasks:['income','cashflow','valuation'].map(k=>({title:k,tool:'fuyao_'+k,arguments_json:JSON.stringify({symbol}),extra:'unexpected'}))};
const review={summary:'review',claims:[{kind:'inference',text:'derived',evidence_ids:['probe'],extra:'unexpected'}],limitations:[],questions:[],extra:'unexpected'};
for(const [name,fn] of [['planExtra',()=>parsePlanResponse(call('propose_research_plan',plan),curatedTools(),[symbol])],['reviewExtra',()=>parseReviewResponse(call('write_evidence_review',review),['probe'])]]){
 try{fn();console.log(name,'ACCEPTED')}catch{console.log(name,'REJECTED')}
}
'@ | node --experimental-strip-types --input-type=module
```

本次实际结果：`fiscalMismatch valid 2026-FY`；`oneYear valid 1`；`unsafeNumber valid 9007199254740992 Infinity`；两种额外字段均 ACCEPTED。相应正确行为与成功/失败标准见各问题的验收标准；当前结果判定为失败。

```powershell
@'
import { normalizeFuyao, compareFinancials } from './lib/buddy/data.ts';
const now='2026-04-02T12:00:00.000Z', symbols=['600519.SH','000858.SZ'], evidence=[];
for(const symbol of symbols){
 const opt={id:symbol+'-i',symbol,retrievedAt:now,sourceUrl:'https://fuyao.aicubes.cn/api/probe'};
 const make=y=>({currency:'CNY',period:'annual',fiscal_period:'FY',thscode:symbol,fiscal_year:y,period_end_ms:Date.parse(y+'-12-31T00:00:00+08:00'),operating_income:100,net_profit:20,act_cash_flow_net:30});
 evidence.push(await normalizeFuyao('income',{data:{item:[make(2025),make(2024)]}},opt));
 evidence.push(await normalizeFuyao('cashflow',{data:{item:[make(2024)]}},{...opt,id:symbol+'-c'}));
}
console.log(JSON.stringify({qualities:evidence.map(e=>e.quality),comparison:compareFinancials(evidence,symbols)}));
'@ | node --experimental-strip-types --input-type=module
```

本次实际结果：4 份证据都是 valid，但选择 `2025-FY`，两行 cashflow/cashConversion 为 null。成功标准：识别完整共同的 `2024-FY`、该期 cashflow 为 30、cashConversion 为 1.5；若采用该期，须同时披露最新 2025 年缺失原因。当前未识别完整共同期，判定失败。

## 已确认的良好边界及无法确认项

静态实现支持扶摇固定路径、年度 `limit=3`、前复权日线、`X-api-key`；iFinD 固定服务器/工具、原始 Authorization 值；HTTPS 域名校验、禁止重定向、默认 45 秒和 3MB、HTTP 与嵌套业务错误处理。模型解析检查完成状态、单个指定函数、任务上限 20、实际 evidence IDs、推断/未知分类、每证券三项核心工具。usage 的 input/output 无效会拒绝，最低计价符合要求，预留使用输入字节数加缓冲及输出上限。

新增 fetch 替身探针确认：普通财务响应的原结构与键序经 `executeTool` 返回仍与输入 JSON 一致；`callModel` 返回中移除独立 `type:"reasoning"` 项。模型调用实际超时设为 120 秒，区别于数据适配器默认 45 秒；要求文件的 45 秒位于金融适配器段，本审查未将该差别推定为模型违规。

演示数据明显标 constructed，正常/缺失测试源码使用真实 Harness 转换，failure 第一次 income transient 注入为真实抛错；公开 dataset 与内联构造数据当前数值一致。缺失 CFO 保留 null，不造零。

**CannotVerify / 无法确认：**服务端隔离与私密配置的实际部署、所有公开返回/保存是否必经 `validateReport`/`completeRun`、真实 MCP 发现与模型实际成功、每日原子预算/预留联动、存储和 UI 安全。原因：前两类集成不在本次源码范围；真实调用材料仅有阶段报告陈述，本次未联网、未读私密缓存。普通/缺失的已存测试调用报告校验，不等价于所有生产调用链都经过校验。不能据此宣布这些跨任务事项通过。

未创建 C 盘任务缓存；正式审查文件保存在 D 盘。
