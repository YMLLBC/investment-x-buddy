# TASK 02 · Harness 独立审查

- 规格符合性（spec compliance）：**不通过**。
- 子任务质量（task quality）：**不通过，需要修正后复审**。
- 审查范围：docs/tasks/TASK_02_HARNESS.md 为唯一子任务规格；对照 docs/reviews/TASK_02_PACKAGE.md、docs/stages/TASK_02_REPORT.md 和 Harness/report 实际代码。未审查 providers/data/UI，未读取凭据或联网，未修改实现。
- 事实：限定测试命令 `node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts` 于本轮退出码 0，25/25 通过。下列新增只读复现均确认缺口；原测试通过不足以证明这些边界符合规格。阶段报告的历史红阶段仅为提交者记录，本次没有重新构造历史版本验证。

## P1 · 数字事实文本和单位没有绑定到验证值

位置：lib/buddy/report.ts:76–89、115–121。

事实：数值 raw=100、证据/verification.unit=USD 时，claim.text 改成 “Price is 100 EUR” 或 “Price is 100%” 仍通过。单位校验仅比较 verification.unit，未验证实际事实文字中的单位。raw 为字符串 “100” 时，文字 “Price is 200 USD (source 100)” 也通过：字符串分支只检查 includes，没有执行数字矛盾检查。上述文字最终可作为 fact 完成/导出。

最小复现：使用下面共同样本，分别修改文字；字符串分支同时将路径改为 stringPrice、value 改为字符串 “100”。实际均 ACCEPTED；成功标准应为拒绝三种不一致事实，并接受一致的 “Price is 100 USD”。

必要修正：数字形式的字符串不能借 includes 逃避数字语义校验；使用明确的数字/单位解析或禁止字符串支持数字事实。将事实文本声明的币种、百分比、数量单位与所验证字段单位绑定，无法确定一致性时拒绝 fact 或要求转为 inference/unknown。增加这三个回归断言。

## P1 · 常见确定性预测和直接交易指令漏检

位置：lib/buddy/report.ts:69–72、96–104。

事实：summary 分别为 “AAPL will reach 500 tomorrow”、“买入苹果”、“Purchase AAPL immediately” 时仍通过。第一条使用证券代码，绕过对 price/stock/share 的前置词要求；后两条绕过有限的动作词和中文目标规则。规格明确要求拒绝确定性价格预测和直接买卖指令。

最小复现：将共同样本 summary 依次替换以上三句。实际均 ACCEPTED；预期均拒绝。此问题属于具体常见表述缺失，不要求证明任意自然语言都可由规则精确理解。

必要修正：统一规范化目标和动作表达，覆盖证券代码目标的未来确定价位、purchase 等直接交易动词及中文公司名目标，统一检查所有报告文字字段。增加三条拒绝回归测试和普通历史数据/未知表述的接受基线，避免只增加孤立示例。

## P1 · 文本及 URL 中的 token/credential 仍被导出

位置：lib/buddy/report.ts:4、8–14、18–26、137–138。

事实：键名 token 会脱敏，但同一秘密位于 raw.note 的 “token=TOKEN_SECRET credential=CREDENTIAL_SECRET” 或 URL 文本 “https://example.com/data?token=QUERY_SECRET” 时，JSON 导出原样保留。文本规则没有通用 token/credential 标签。递归只识别对象键，不能保护这些常见日志/URL 形式。

最小复现：按共同样本构造 run，将 raw.note/raw.source 设置成以上内容并执行 exportReport(run,"json")。实际 /TOKEN_SECRET|CREDENTIAL_SECRET|QUERY_SECRET/ 命中；预期三种模拟秘密均不存在，并保留非敏感来源/事实元数据。

必要修正：统一对象键与文本的敏感字段集合，覆盖 token、credential 及常见分隔形式；解析 URL 查询参数进行字段级脱敏，保留来源结构。对 JSON 和 Markdown 导出各添加含文本秘密及 URL 查询秘密的断言；不得仅删除整个 evidence 来规避校验。

## P2 · 整个 limits=null 被当作未设置预算

位置：lib/buddy/harness.ts:113–115。

事实：createRun({...validInput, limits:null}) 接受并使用默认限额。当前测试仅覆盖 limits 内某个值为 null；整体 null 绕过 truthy 检查。与“拒绝无效 limits”的关闭失败要求不一致，外部 JSON 输入尤其容易到达此边界。

最小复现：共同样本 input 加 limits:null；实际 ACCEPTED。预期 INVALID_LIMITS；limits 未提供或 {} 应接受，合法收紧值仍接受。

必要修正：仅 undefined 表示省略；所有已提供的 limits 必须为普通对象，增加 null（以及 false/0/空字符串）的拒绝断言。

## 共同样本及可执行只读复现

在 D:/projects/THSwork/investment-x-buddy 的 PowerShell 执行以下代码。只导入本次审查模块，不写文件、不发网络请求。当前输出每条 actual 均为 ACCEPTED，exportLeaks=true；修正后相关断言须拒绝违规输入，exportLeaks=false。

```powershell
$probe = @'
import { createRun } from './lib/buddy/harness.ts';
import { validateReport, exportReport } from './lib/buddy/report.ts';
const now = '2026-10-02T00:00:00.000Z';
const evidence = {id:'e1',title:'Quote',provider:'Demo',sourceUrl:'https://example.com',retrievedAt:now,asOf:now,unit:'USD',scope:'AAPL',quality:'valid',summary:'Quote',raw:{price:100,stringPrice:'100'},hash:'abc'};
const report = () => ({title:'Research',summary:'Observed data',claims:[{id:'c1',kind:'fact',text:'Price is 100 USD',evidenceIds:['e1'],verification:{evidenceId:'e1',fieldPath:'price',value:100,unit:'USD'}}],limitations:[],questions:[],generatedAt:now});
for (const text of ['Price is 100 EUR','Price is 100%','AAPL will reach 500 tomorrow','买入苹果','Purchase AAPL immediately']) {
 const r=report(); if (text.startsWith('Price')) r.claims[0].text=text; else r.summary=text;
 try {validateReport(r,[evidence]); console.log(JSON.stringify({text,actual:'ACCEPTED'}));}
 catch(e) {console.log(JSON.stringify({text,actual:'REJECTED',message:e.message}));}
}
const stringFact=report();
stringFact.claims[0].text='Price is 200 USD (source 100)';
stringFact.claims[0].verification={evidenceId:'e1',fieldPath:'stringPrice',value:'100',unit:'USD'};
try {validateReport(stringFact,[evidence]);console.log(JSON.stringify({text:stringFact.claims[0].text,actual:'ACCEPTED'}));}
catch(e){console.log(e.message);}
const input={id:'r',ownerId:'o',goal:'Research',title:'R',mode:'demo',plan:[{id:'t',title:'Read',tool:'quote',arguments:{},status:'pending',attempts:0}],now};
const run=createRun(input);
run.report=report();
run.evidence=[{...evidence,raw:{...evidence.raw,note:'token=TOKEN_SECRET credential=CREDENTIAL_SECRET',source:'https://example.com/data?token=QUERY_SECRET'}}];
console.log(JSON.stringify({exportLeaks:/TOKEN_SECRET|CREDENTIAL_SECRET|QUERY_SECRET/.test(exportReport(run,'json'))}));
try {const x=createRun({...input,limits:null});console.log(JSON.stringify({nullLimits:'ACCEPTED',limits:x.limits}));}
catch(e){console.log(e.message);}
'@
$probe | node --experimental-strip-types --input-type=module
```

本次复现命令退出码 0 仅表示探针执行成功，输出中的接受和秘密泄漏证明产品校验失败；不能将该退出码视为功能通过。

## 已验证通过及集成边界

- 审批前不可执行；拒绝审批/用户停止不可再审批或恢复；停止/暂停状态的 succeedTask/failTask 被拒绝；完成态停止保留原结果。
- 顺序开始、检查点、不可变状态转换、成功幂等和最多三次总调用，以及失败恢复保留已完成任务/证据，均由现有测试通过支持。
- runtime 累计保留 startedAt/elapsedMs，暂停时间计入原限额；工具/模型/费用预算无法通过 resumeRun 重置。超预算在相应入口暂停/拒绝，负数用量被拒绝。
- 压缩保留目标、显式记忆、证据 ID 与原始 raw，记录事件/检查点；现有结构将工具摘要标记为不可信数据。压缩阈值是触发值，固定内容可能超过阈值，阶段报告已说明。
- 无 raw 路径（即使声明 null）、错误 raw 数字、不可用引用、缺失/陈旧/冲突证据作为事实及缺失元数据的拒绝测试通过；导出保留来源/时间/范围/hash/验证路径，未知推理字段不进入允许列表。
- 同一 task 重试期间旧调用结果的身份区分是现有接口无法表达的集成边界，阶段报告明确要求调度层检查版本/调用身份；本次不将已说明的签名边界升级为 providers/UI 范围缺陷。未验证调度层实际落实，不能据此声称整个系统已隔离该类旧结果。

建议阻止该子任务以“审查通过”集成；完成上述必要修正、补充有正向基线的回归测试，并重新运行限定测试后复审。

