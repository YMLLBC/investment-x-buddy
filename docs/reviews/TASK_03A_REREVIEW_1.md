# Task03A 首轮修正限定复审

审查日期：2026-10-02（Asia/Shanghai）。版本：`0f0e5a8`；修正区间：`7163acb..0f0e5a8`。

**Spec compliance（规格符合性）：PASS / 通过，仅限本轮 5 项问题及修正 diff。**

**Task quality（任务质量）：PASS / 通过，仅限本轮 5 项问题及修正 diff。**

原 5 项均 **ADDRESSED（已处理）**，本轮未发现新的阻断缺陷。此结论不代表存储、服务、UI、真实接口或整站集成验收完成。

## 范围与验证依据

对照原要求 `docs/tasks/TASK_03A_DATA_MODEL.md`、首轮 `docs/reviews/TASK_03A_REVIEW.md`、指定 `docs/reviews/TASK_03A_FIX_PACKAGE.diff` 和追加后的 `docs/stages/TASK_03A_REPORT.md`。仅复审变动的 data/model/research 实现、对应新增测试及其对原五项的影响，未扩大至其他源码。

限定实现及测试文件当前无未提交变动。修正包涉及 data/model/research 和 3 个测试文件；版本区间另有阶段报告追加。原测试断言未删除或削弱，新增 14 项与目标问题对应，未增加无关产品行为。

阶段报告记录模块测试 **35/35 通过**、限定严格 TypeScript 退出 0、diff 检查退出 0，并记录了新增回归修正前的实际失败和原审查探针修正后的输出。这些属于实现方已执行的验证记录；本复审遵守“不重跑已覆盖相同测试”，未重复该套测试或原探针。本次另执行未被该套新增断言覆盖的窄边界探针，见下文，实际退出 0。

## 五项复审结论

### 1. 不安全数值和 Infinity 比值：ADDRESSED

代码证据：`lib/buddy/data.ts:6-18`、`:56-59`、`:92-93`。

数值必须有限且绝对值不超过 `Number.MAX_SAFE_INTEGER`；数字字符串在转换前后比较规范化十进制表示，拒绝静默舍入和下溢。异常字段仍保留 raw/fieldPath/hash，归一化值为 null、证据标 conflict。现金转换比及净利率计算后再次检查有限性，异常返回 null，并进入 issues → unknown，阻止 Infinity 研究推断。

对应新增测试覆盖安全边界、精度丢失、原始键序/hash、现金转换比/净利率溢出和报告未知输出。阶段报告的原探针已由 `unsafeNumber valid … Infinity` 变为 `conflict null null undefined`。本次新探针确认四种合法等值十进制写法仍可接受，未观察到此次精度校验误拒绝该类输入。

### 2. 财年与期末错配：ADDRESSED

代码证据：`lib/buddy/data.ts:43-53`。

按 UTC+08:00 的境内日历检查财年为允许范围内整数、期末为该年 12 月 31 日；错配标 conflict，不赋予合法比较期。asOf 仍保留 UTC，不以 UTC 日期误判境内年末。

新增测试覆盖错配财年、半年期末、非整数年份以及正常境内午夜/UTC 年末。阶段报告原错配探针变为 `conflict undefined null`。本次追加 UTC `2025-12-31T20:00:00Z`（境内已是 2026-01-01）的边界，实际判 conflict，符合财年要求。

### 3. 年度历史覆盖披露：ADDRESSED

代码证据：`lib/buddy/data.ts:39-61`、`:68-71`；`lib/buddy/research.ts:22-24`。

保留实际返回行，按不同、合法年度且包含安全数值的行计数；重复年度不重复计数，不安全或全缺失行不进入有效覆盖。少于三年度在 scope/summary 明确说明，并汇入报告 limitations。

合法单年 FY 的事实及单期比较保持有效，未将公司历史较短伪造为数字无效。公开演示仍为单年构造数据，但报告明确披露其历史覆盖不足，满足首轮澄清的完整性要求。新增测试覆盖 1/2/3 年、重复 FY、不安全/全缺失行以及演示最终报告。

### 4. 完整共同年度及回退披露：ADDRESSED

代码证据：`lib/buddy/data.ts:76-90`；`lib/buddy/research.ts:18`。

在共同有效收入年度内，选择全部公司收入、合并利润、CFO 均可用的最近完整期；若最新共同收入年度缺字段，明确记录具体公司、缺失字段、最新年度与回退年度，并告知旧期不能视为最新期。所有共同期都不完整时，保留最近共同收入年度、null 和缺失说明。

新增测试覆盖回退、最新完整期及全不完整情况。阶段报告原探针实际选择 `2024-FY`，两家公司 CFO=30、现金转换比=1.5，且同时披露 `2025-FY` 的 CFO 缺失。既有净利非正保护和缺失不补零逻辑保留，未静默混用不同年度。

### 5. 完整模型函数 schema 校验：ADDRESSED

代码证据：`lib/buddy/model.ts:9-28`、`:32`、`:53`、`:77-88`。

发送和解析共用 planParameters/reviewParameters；解析递归验证当前 schema 的对象/数组/字符串、必需属性、枚举、数量及额外属性。规划顶层/任务、解读顶层/claim 的 extra 均有对应回归，原单函数、completed、工具参数、证券范围、实际 ID 和核心工具覆盖检查保留。

本次追加必需 questions 缺失、嵌套 text 错误类型、questions 容器类型错误的探针，三者均被拒绝；合法 unknown 且空证据引用仍成功。未观察到新校验误拒绝允许的 unknown 输出。

## 本次独立窄边界探针

工作目录：`D:\projects\THSwork\investment-x-buddy`。以下命令不联网、不写测试源码或缓存。

```powershell
@'
import assert from 'node:assert/strict';
import { numeric, normalizeFuyao } from './lib/buddy/data.ts';
import { parseReviewResponse } from './lib/buddy/model.ts';
for(const s of ['+00012.5000e-1','125e-2','.125e1','1.25000'])assert.equal(numeric(s),1.25);
console.log('decimal spelling variants: 4/4 accepted as 1.25');
const call=args=>({status:'completed',output:[{type:'function_call',name:'write_evidence_review',arguments:JSON.stringify(args)}]});
const valid={summary:'核验',claims:[{kind:'unknown',text:'待核验',evidence_ids:[]}],limitations:[],questions:[]};
const cases=[(({questions,...rest})=>rest)(valid),{...valid,claims:[{...valid.claims[0],text:7}]},{...valid,questions:{}}];
for(const c of cases)assert.throws(()=>parseReviewResponse(call(c),[]));
assert.equal(parseReviewResponse(call(valid),[]).claims[0].kind,'unknown');
console.log('shared schema missing/type boundary: 3/3 rejected; valid unknown accepted');
const symbol='600519.SH';
const e=await normalizeFuyao('income',{data:{item:[{thscode:symbol,currency:'CNY',period:'annual',fiscal_year:2025,fiscal_period:'FY',period_end_ms:Date.parse('2025-12-31T20:00:00Z'),operating_income:100,net_profit:20}]}},{id:'boundary',symbol,retrievedAt:'2026-04-02T12:00:00Z',sourceUrl:'https://fuyao.aicubes.cn/api/probe'});
assert.equal(e.quality,'conflict');
console.log('UTC Dec31 / mainland Jan1 boundary: conflict');
'@ | node --experimental-strip-types --input-type=module
```

预期与成功标准：4 个等值十进制写法都返回 1.25；3 个 schema 错误全部抛错，合法 unknown 正常解析；跨境内年界的期末标 conflict；全部断言成功且退出 0。实际输出与以上 3 条 console 文本一致、退出 0，判定成功。

## 结论边界

未发现此次 fix diff 引入的新阻断问题。首轮跨任务 CannotVerify 仍保留：所有生产返回/保存是否必经报告安全校验、服务端密钥隔离、真实接口调用、预算/预留联动、存储和 UI 不在本轮验收范围。

正式复审文件存于 D 盘；未创建 C 盘任务缓存。未改源码、未联网、未读 keys、未提交。
