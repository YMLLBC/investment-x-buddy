# TASK 02 · 修正复审第 1 轮

- 规格符合性（spec compliance）：**不通过**，数字事实类仍有可复现绕过。
- 子任务质量（task quality）：**不通过**，需修正剩余数字边界及新增历史文字误拒绝后复审。
- 范围：仅 TASK_02_FIX1_PACKAGE.md（BASE e333f66139532a3361fa9047eb2a25916d08ce1a，HEAD c645edf902622d83fe79da4a927d10578076a829）、原 TASK_02_REVIEW.md 和追加阶段报告中四类修正及其直接回归。不审查 providers/model/UI，不读取密钥，不联网，不修改实现。
- 验证事实：本轮原限定测试 `node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts` 退出码 0，30/30 通过；原审查探针也已重新执行。另行执行下文只读回归断言：5 项中 1 通过、4 失败，退出码 1。

## 原四类问题状态

1. 数字事实/单位：**部分修复，未关闭**。原 “100 EUR”、“100%” 和字符串原值 “100” 支持错误 “200 USD (source 100)” 均已拒绝，一致数字字符串、浮点值、metric 单位正向测试通过。但紧贴单位的额外数字仍能被遗漏，详见 P1。
2. 确定性预测/直接交易：**原具体复现已修复，但产生 P2 回归**。“AAPL will reach 500 tomorrow”、“买入苹果”、“Purchase AAPL immediately” 在全部报告文字位置的拒绝断言通过；新增模式错误拦截普通历史文字，见下。
3. token/credential 文本和 URL 脱敏：**本轮验证通过**。原探针 exportLeaks=false；新增测试证明 JSON/Markdown、嵌套 raw、编码查询键及 Authorization/apiKey/token/credential 均不含模拟秘密，同时保留非敏感 URL 路径/查询、验证路径和 hash。未对未修改集成进行外推。
4. 整体 limits=null：**本轮验证通过**。仅 undefined 可省略；null/false/0/空字符串/数组拒绝，{} 及合法收紧值接受。无状态转换或预算累计重置变更。

## P1 · 贴单位的数字绕过新事实解析

位置：lib/buddy/report.ts:103、109–120。

事实：证据 raw.price=100，unit=USD，verification 保持对应路径/值/单位，以下 fact 文本仍通过：

- “Price is 200USD (source 100 USD)”
- “Price is 100 USD and 200EUR”

另行调用 exportReport(run,"json")，确认第一条错误 fact 实际进入导出（wrongFactExported=true），不是仅校验内部返回的问题。

原因：新数字正则要求数字后不是单词字符，所以 200USD/200EUR 全部不匹配；余下单位检查使用单词边界，数字与单位之间也没有单词边界，再次漏掉。这使有空格的正确 100 USD 足以通过，未核验无空格的错误数字/币种。

必要修正：整体识别数字及紧随单位，不能将“数字后有字母”一概忽略；对不确定的剩余数字/单位失败关闭。将明确证券代码/期间等排除与财务数字解析分开，继续保留同值科学记数法、精确浮点、数字字符串和原有正向基线。补充无空格的错误数字、错误币种拒绝断言以及允许的正确格式断言；不得仅为这两句文本添加黑名单。

最小复现和标准：下文两条 assert.throws 目前均报告“缺少预期异常”；修正后均通过，同时 “Price is 100 USD” 接受基线继续通过。这是原第一类问题的剩余边界，没有扩展审查范围。

## P2 · 新交易动作规则误拒绝历史名词说明

位置：lib/buddy/report.ts:89、91。

事实：保持合法报告及合法 fact 不变，summary 为下列普通说明时被拒绝：

- “Short interest is disclosed in historical data.”（卖空比例见历史数据。）
- “Purchase price was 100 USD yesterday.”（昨天的购买价格为 100 美元。）

以上都不是价格预测或交易指令。新增 tradingAction 把句首 short/purchase 后的任意内容当作命令，没有识别 short interest、purchase price 这些名词短语。以 “Historical purchase price...” 开头则接受，表明拒绝来自新增句首动作模式。

影响：合法报告可被 completeRun/exportReport 的共同报告校验阻断，不能仅通过改变文案规避而认定修正质量通过。

必要修正：区别动作指令与金融名词/历史叙述，在保留原指令拒绝断言的同时添加上述历史文字接受基线；对短语做有依据的语义约束，避免将任何句首词视为动词。不得通过移除整条交易校验使原违规样例重新通过。

## 可执行只读断言

工作目录 D:/projects/THSwork/investment-x-buddy；PowerShell 执行：

```powershell
$probe = @'
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateReport } from './lib/buddy/report.ts';
const now='2026-10-02T00:00:00.000Z';
const e={id:'e1',title:'Quote',provider:'Demo',sourceUrl:'https://example.com',retrievedAt:now,asOf:now,unit:'USD',scope:'AAPL',quality:'valid',summary:'Quote',raw:{price:100},hash:'abc'};
const report=()=>({title:'Research',summary:'Observed data',claims:[{id:'c1',kind:'fact',text:'Price is 100 USD',evidenceIds:['e1'],verification:{evidenceId:'e1',fieldPath:'price',value:100,unit:'USD'}}],limitations:[],questions:[],generatedAt:now});
test('baseline exact fact is accepted',()=>assert.doesNotThrow(()=>validateReport(report(),[e])));
for(const text of ['Price is 200USD (source 100 USD)','Price is 100 USD and 200EUR']) test('reject contradictory compact number/unit: '+text,()=>{const r=report();r.claims[0].text=text;assert.throws(()=>validateReport(r,[e]));});
for(const text of ['Short interest is disclosed in historical data.','Purchase price was 100 USD yesterday.']) test('accept ordinary historical description: '+text,()=>{const r=report();r.summary=text;assert.doesNotThrow(()=>validateReport(r,[e]));});
'@
$probe | node --experimental-strip-types --input-type=module
```

本轮真实结果：tests=5、pass=1、fail=4、退出码 1。修正完成标准：原限定 30 项继续通过，上述 5 项全部通过且退出码 0；原预测/指令样例继续拒绝，脱敏探针继续无泄漏。

阶段报告历史红阶段是提交者记录，本轮未重建历史版本证明；本报告通过/失败判断均基于本轮命令输出。正式复审文件已存 D 盘，未生成需清理的 C 盘缓存。

