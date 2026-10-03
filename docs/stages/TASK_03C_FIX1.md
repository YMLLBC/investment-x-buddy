# Task 03C 审查修复 1

日期：2026-10-03。正式目录：`D:/projects/THSwork/investment-x-buddy`。

## 审查事实与根因

主代理转交两项已复现 P2：第一项由九条各 1986 字符的已确认 memory 产生约 19843 字符父 context，创建子研究时对整个 `JSON.stringify(...)` 执行 `slice(0,6000)`，使 JSON 字符串和闭括号被截断，engine 的 parentResearch 解析失败并丢弃父摘要。第二项 live 计划恰好三个工具且 maxToolCalls=3，三个步骤全部完成后复核遇到临时 TIMEOUT，研究 paused/model_failure、modelCalls=2，尚有模型预算，却被 core.resumeRun 的全阶段 toolCalls>=3 检查阻挡。

上述独立审查原报告未落盘，原因由主代理说明为 reviewer 用量额度限制；本报告保存转交的审查事实，并以本地自动化再次复现，不以转交结论代替验证。

## 修正

`server.ts` 在序列化前限制 summary 文本，使用 `for...of` 按 Unicode 码点遍历，并按 `JSON.stringify(char)` 的实际转义长度计算剩余额度。最终整个 JSON 最多 6000 个 UTF-16 代码单元，完整保留 parentId/status，控制字符、引号、反斜杠计入逃逸长度，不拆分合法代理对。没有对最终 JSON 截断，也没有改变 owner/mode 的父研究授权检查。

`engine.ts` 增加 resumeAtCheckpoint：仅对 live、非 planning 且全部工具任务已 completed 的阶段采用复核恢复检查。必须已审批、处于合法 paused/failed 且非永久失败/重试耗尽；保留累计 elapsed 的原始 startedAt，仍拒绝 runtime/model/cost 达到上限。此阶段不再要求额外工具额度，因为下一步只有模型复核；所有其他阶段仍调用既有 core.resumeRun。恢复只更新运行状态、停止原因和事件，未改变 limits、既有工具/模型调用次数、token、费用或证据。下一次 advance 的模型保守费用预留和 UTC 日预算检查继续生效。

只修改 `lib/buddy/server.ts`、`lib/buddy/engine.ts`、`tests/server.test.ts`，追加原阶段报告并创建本报告。没有修改 core/harness、模型、供应商、存储、类型、UI 或迁移；未联网、未读取密钥或私有记录、未提交。

## 红绿验证

命令均在正式目录执行。

红：`node --experimental-strip-types --test --test-name-pattern='P2' tests/server.test.ts`。预期两类问题被真实 SQLite 和确定性 pipeline 重现。实际 **3 tests / 0 pass / 3 fail，退出 1**：长 memory 和 Unicode/控制字符两例都出现 `Unterminated string in JSON at position 6000`；三工具完成后的复核恢复为 `409 !== 200`。

绿：同一命令修正后 **3/3 通过，退出 0**。随后增加模型次数、费用和原始起点运行时长耗尽的保护回归，验证每项仍返回 409/BUDGET_EXHAUSTED、额外外部调用为零，SQLite 中版本、预算和证据与请求前完全一致。

最终服务命令：`node --experimental-strip-types --test tests/server.test.ts`。预期 fail=0，恢复后仅新增一次模型调用、toolCalls 仍为 3、limits/已存证据不变，并最终经报告校验完成。实际 **26 tests / 26 pass / 0 fail，退出 0**，约 2.05 秒；其中原有服务回归 22 项、新增审查回归 4 项。

类型检查：`npm run typecheck`，预期 tsc 无诊断并退出 0；实际退出 **0**、无诊断。

静态检查：`node node_modules/eslint/bin/eslint.js lib/buddy/server.ts lib/buddy/engine.ts tests/server.test.ts`。预期无诊断并退出 0；实际退出 **0**、无诊断。

## 验证边界

使用 tests/support/d1.ts 的真实内存 SQLite 与 executeDemo 的实际构造证据；live 模型响应为只读依赖注入，用于严格解析和超时/预算分支。没有实际网络请求。本次构建、真实 API、浏览器和发布由主代理负责，不在本地测试结果中宣称完成。

正式修改与报告均在 D 盘。本次没有创建 C 盘任务缓存，无需执行 C 盘清理。两项 P2 已有对应的红绿证据；没有新增未解决的服务契约疑问。
