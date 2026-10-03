# TASK 02 · Harness 内核阶段报告

状态：已实施，限定文件验证通过。未创建提交，交由主任务审查与提交。

## 所属文件

- lib/buddy/harness.ts：不可变状态转换、审批、顺序执行、预算、重试、停止、检查点、上下文压缩。
- lib/buddy/report.ts：证据与事实逐字段校验、报告安全检查、Markdown/JSON 导出和递归脱敏。
- tests/harness.test.ts、tests/report.test.ts：25 项行为及边界测试。
- docs/stages/TASK_02_REPORT.md：本报告。

## 验证证据

工作目录：D:/projects/THSwork/investment-x-buddy。

红阶段：
- 命令：`node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`。
- 初始 20 项：17 失败、3 通过；3 项拒绝测试存在占位模块假阳性，立即加入有效输入基线。
- 加固后的红阶段命令：`node --experimental-strip-types --test --test-reporter=dot tests/harness.test.ts tests/report.test.ts`；20 项全部因 NOT_IMPLEMENTED 失败，无导入错误。
- 实现后初始绿阶段：20/20 通过。
- 追加边界红阶段：25 项，21 通过、4 失败；确认空预算、非暂时失败恢复、嵌入凭据和未识别推理导出、目标价表述的缺口。

最终绿阶段：
- `node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`：25/25 通过，0 失败，退出码 0。
- `node node_modules/typescript/bin/tsc --noEmit --allowImportingTsExtensions --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。
- `node node_modules/eslint/bin/eslint.js lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。

预期行为与判断标准：未审批不执行；任务只能按顺序调用；停止后的结果被拒绝；暂时失败保留成功任务与证据，最多三次总调用；预算耗尽在新增调用前暂停；报告事实必须匹配有效证据的真实 raw 路径、数值和单位；导出不得含模拟凭据。上述断言全部通过才判断内核验证成功。本报告不声称服务器、UI 或真实上游集成已验证。

## 接口及集成约束

1. 接口与 types.ts 保持一致。额外导出 validateEvidence、redactText、redactValue 供同范围代码复用，不改变领域类型。
2. createRun 的签名没有工具注册表，因此校验新任务形状、参数边界和预算；调用方必须先 validatePlan(plan, tools)，再 createRun。注册 Schema 支持 object/array/string/number/integer/boolean/null、required/properties/enum/additionalProperties 和常用长度/数值边界；未识别 Schema 关键字直接拒绝，默认额外参数禁止。
3. beginTask 计入一次真实工具调用及一次 attempts；调用方仅在即将实际执行工具时调用。失败停因 transient_failure 可恢复；permanent_failure、retry_limit 不可恢复。
4. 恢复保留原始 startedAt 和 elapsedMs，暂停时间计入总运行时限；已耗尽时间、工具、模型、费用预算不允许恢复绕过。模型用量记录允许实际发生的超限费用入账后显式暂停，调用方还需在真正发模型请求前检查模型和费用预算。
5. 完成任务保留 running 状态，只有 validateReport 通过后 completeRun 才完成整个运行。事实采用单一精确 raw 值；计算、转换单位、跨证据结论应标注 inference。字段路径为点分路径，数组索引如 rows.0.value；禁止原型路径。null 只在字段确实存在时有效。
6. 服务端应在异步调用返回后校验持久化运行版本和任务调用身份，再调用 succeedTask/failTask。现有签名没有调用 ID；同一任务重试期间旧请求返回的区分需在调度层处理。停止/暂停状态结果在内核被拒绝。
7. 压缩阈值为触发值；显式记忆、目标、约束、全部证据 ID 必须保留，因此大量固定内容时压缩后可能仍超过阈值。原始 raw 永不删改，摘要及工具载荷始终作为不可信数据。报告文本检查为确定性规则，无法替代对任意自然语言含义的人工审查。

## 安全与存储

未读取或使用凭据；未托管、未修改依赖、未操作 ACL。正式文件均已写入 D 盘项目。普通写入权限问题使用已获授权的 require_escalated 文件写入解决。测试目录初始不存在，创建后写入测试；无本任务 C 盘缓存需要清理。

## 审查修正第 1 轮（2026-10-02）

依据 docs/reviews/TASK_02_REVIEW.md 的三项 P1 和一项 P2，已修正并等待独立复审；此记录不表示审查已通过。原有 25 项测试完整保留，新增 5 项含正向基线的审查回归测试。

- 数字事实文本必须逐个匹配原始值且紧跟 verification.unit 的原文；包括浮点数、科学记数法和数字字符串。原始 raw 与 verification.value 仍须类型和值严格相等。拒绝额外不同数字、EUR/% 等不符单位及额外每股单位；支持 metric.fieldPath 选择 metric.unit，例如 CNY 元。非数字字符串不能为数字事实提供证明；计算结果可作为带引用的 inference。
- 所有报告文字经统一规范化与校验，覆盖证券代码的将来确定目标价、purchase 等英文交易动词及中文公司名交易指令。历史价格、未来未知等表述为接受基线。
- 对象键与文本使用同一敏感标签集合，补充通用 token/credential；URL 先解析查询参数并逐字段脱敏，覆盖编码后的参数名，保留 URL 路径及 symbol 等非敏感查询参数。Markdown 与 JSON 都验证无模拟秘密且保留来源、字段路径和 hash。
- 仅 limits=undefined 表示省略；limits=null/false/0/空字符串/数组拒绝，{} 与合法收紧对象仍接受。

红阶段命令：
`node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`
结果：30 项，25 通过、5 失败，退出码 1；失败分别复现无效整体预算、错误单位/数字字符串、数字字符串附加不同数值、常见目标价/交易指令及 token/URL 泄漏。

实施中出现一次正则字符串转义语法错误与一次 TypeScript 类型收窄错误，均修正；不将这些实施错误当作需求红阶段证明。

最终验证命令及结果：
- `node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`：30/30 通过，0 失败，退出码 0。
- `node node_modules/typescript/bin/tsc --noEmit --allowImportingTsExtensions --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。
- `node node_modules/eslint/bin/eslint.js lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。

通过判断：所有新增拒绝断言与精确浮点/数字字符串/CNY 元/推断/历史数据/未知表述接受基线同时通过。仍只验证内核与报告模块，不代表服务器或真实上游完成验证。无类型合同变更，未读取密钥、未修改其他文件、未提交。

## 审查修正第 2 轮（2026-10-02）

依据 docs/reviews/TASK_02_REREVIEW_1.md 的剩余 P1 与新增 P2，已修正并等待复审。原 30 项测试完整保留，新增 3 项回归测试。

- P1：数字识别不再以字母右边界排除数字；仅在解析前排除可信证券代码/期间元数据，其他剩余数字全部核验。因此 200USD、200EUR 以及错误贴单位的数字与正确来源数字混用均被拒绝；JSON 和 Markdown 导出也明确验证拒绝错误 fact。正确 100USD、100 USD、1e-7CNY 元及可信 600519.SH/2025Q4 接受；原精确浮点、数字字符串等基线保留。
- P2：交易动作检测逐句检查，以金融名词主体加历史/陈述系动词区分说明与指令。Short interest is...、Purchase price was...、Short positions were...、Purchase costs are... 在所有报告文字位置接受；Short AAPL immediately、Purchase AAPL immediately、You should purchase AAPL、Please short shares of AAPL 仍拒绝。未移除既有预测或交易规则。

红阶段：
`node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`
结果：33 项，30 通过、3 失败，退出码 1；分别确认贴单位数字绕过、正确紧凑格式误拒绝、历史金融名词误拒绝。

最终绿阶段：
- `node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`：33/33 通过，0 失败，退出码 0。
- `node node_modules/typescript/bin/tsc --noEmit --allowImportingTsExtensions --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。
- `node node_modules/eslint/bin/eslint.js lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。

判断标准：原 30 项全部通过，紧凑错误数字/单位及错误导出拒绝，合法紧凑精确数值、历史陈述接受，原预测与交易指令仍拒绝。数字出现在未声明的代码/期间等文字中时会按剩余数字处理；调用方应使用证据的明确 scope/symbol/metric.period 元数据。仅修改 report.ts、report.test.ts 并追加本报告，无其他模块或类型变更，未读取密钥、未提交。

## 审查修正第 3 轮（2026-10-02）

依据 docs/reviews/TASK_02_REREVIEW_2.md 的历史名词豁免后续交易动作 P1，已修正，等待独立复审。原 33 项测试保留，新增 2 项。

修正：扫描每个独立 buy/sell/purchase/short/liquidate 动作词，金融名词陈述例外仅校验当前词后紧邻的局部金融主体及报告系动词；不会消费或豁免同句后续动作。历史 short interest/purchase price 等合法说明可以出现在同一句；每个后续动作仍独立验证。

新增回归覆盖：
- 复审三条混合句，以及 therefore/please、and/we advise、liquidate 等连接后的命令；在标题、摘要、限制、问题、推断五类文字字段均拒绝。
- 同句多个合法历史名词陈述及分句历史陈述继续接受。

红阶段：`node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`：35 项，34 通过、1 失败，退出码 1。失败确认第一条历史说明加同句 purchase 命令被错误接受；新增纯历史正向基线通过。

最终验证：
- `node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`：35/35 通过，0 失败，退出码 0。
- `node node_modules/typescript/bin/tsc --noEmit --allowImportingTsExtensions --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。
- `node node_modules/eslint/bin/eslint.js lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。

判断标准：原 33 项继续通过，混合句中明确交易动作逐个拒绝，多个合法历史短语继续接受。没有变更领域类型、状态机或调用方；只修改 report.ts、report.test.ts 并追加阶段报告，未读取密钥、未提交。

## 审查修正第 4 轮（2026-10-02）

依据 docs/reviews/TASK_02_REREVIEW_3.md 的 short-term debt 误拒绝 P2，已完成限定修正，等待独立复审。原 35 项测试完整保留，追加 2 项回归测试。

根因与修正：动作扫描使用单词边界，因此 short-term 中的 short 也会成为候选动作。仅当当前 short token 后紧邻完整的 -term 词时，按复合形容词给予局部例外；原逐 token 扫描及金融名词规则保留，同句其他 purchase/short 等动作仍单独检查。没有恢复整句豁免，也没有修改数字、单位、证据、脱敏或运行状态逻辑。

新增覆盖：普通短期债务说明、历史短期债务说明、大小写变体及同句 purchase costs 名词说明，在标题、摘要、限制、问题和推断五类字段接受；明确 Short AAPL immediately，以及短期债务说明前后或同句的 purchase/short 命令，在上述五类字段均拒绝。

红阶段（先追加测试、尚未修改实现）：
- 命令：`node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`。
- 结果：37 项，36 通过、1 失败，退出码 1。新增正常说明测试在 title 的 The company has short-term debt. 上报“出现了不应发生的异常”，实际错误为“报告无效：预测、回报保证或交易指令”；原 35 项和新增混合命令拒绝测试通过。此失败验证了合法语境误拒绝，非导入或语法错误。

绿阶段与静态检查（工作目录 D:/projects/THSwork/investment-x-buddy）：
- `node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`：37/37 通过，0 失败，退出码 0。
- `node node_modules/typescript/bin/tsc --noEmit --allowImportingTsExtensions --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。
- `node node_modules/eslint/bin/eslint.js lib/buddy/harness.ts lib/buddy/report.ts tests/harness.test.ts tests/report.test.ts`：退出码 0。
- 将 TASK_02_REREVIEW_1.md 的 5 条探针、TASK_02_REREVIEW_2.md 的 3 条断言和 TASK_02_REREVIEW_3.md 的短期债务断言组合于内存，通过 `$probe | node --experimental-strip-types --input-type=module` 执行：9/9 通过，0 失败，退出码 0，未生成探针文件。

成功标准：原 35 项与新增 2 项同时通过；短期债务正常陈述接受；明确做空指令和同句混合命令拒绝；复审组合 9 条全部通过；限定 TypeScript/ESLint 退出码均为 0。以上标准实际满足，仅代表限定模块和样例验证，不表示任意自然语言或服务器集成已验证。

本轮只修改 lib/buddy/report.ts、tests/report.test.ts 并追加本报告；未提交、未读密钥、未改 ACL。三个正式文件均位于 D 盘项目，本轮 apply_patch 写入成功；未生成需要清理的 C 盘缓存。
