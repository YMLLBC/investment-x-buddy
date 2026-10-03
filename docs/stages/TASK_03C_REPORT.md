# Task 03C 服务编排报告

日期：2026-10-02。正式路径：`D:/projects/THSwork/investment-x-buddy`。

## 实现与范围

新增 `lib/buddy/server.ts`、`lib/buddy/engine.ts`、`app/api/buddy/[...path]/route.ts`、`tests/server.test.ts`，本文件记录本地验证。按已批准的容量修正，曾将 `model.ts` 的 review 输出额度从 2200 改为 6000，并追加 `tests/model.test.ts` 容量回归；主代理实际联网复测后将最终额度改为 **12000**。本子任务没有读取密钥、真实缓存、`.env.local`、`.dev.vars` 或 private-records，没有联网或提交。

服务入口 `handleBuddy(request, env, dependencies?)` 接收合法的显式字符串配置字段和可选 `DB`。可选依赖只用于测试控制时钟、延迟只读工具与模型响应；路由没有注入依赖，生产默认分别调用 `executeTool` / `executeDemo` / `callModel`。纯服务不导入 Cloudflare；只有 route 导入 `cloudflare:workers` 并转发 GET/POST/DELETE。

## API 与集成点

- 签名 HttpOnly 会话；首次 bootstrap 创建 demo，同一 owner 通过访问码升级 live 或降级 demo，刷新七天有效期。公开 session 只含 mode/expiresAt。live 会话可查自己的 demo，demo 会话不能查 live。所有记录查询和 mutation 以 owner/mode 为边界，同 ID 在别的 scope 已存在则 409。
- bootstrap 返回既有 client 契约中的 session/runs/memory/tools/limits/capabilities；live 另返回每日预算。RunView 删除 ownerId，将 evidence.raw 置 null，executing 仅反映有效租约。原始证据专用接口返回完整已脱敏 raw，不返回 leaseId。报告完成前不能导出，附件名使用 RFC 5987 UTF-8 百分号编码。
- 创建请求严格校验 goal、1–3 个证券代码、场景、UUID、parentId 和只能收紧的 limits；请求 UUID 作为 run id，实现幂等。demo 使用真实 `demoPlan`；live 保存不执行的 fuyao_search 占位并 planning=true，下一次 advance 执行真实规划。创建时快照显式记忆，父研究仅限同 owner/mode；父摘要进入 planning/review，并在确定性上下文压缩后保留。不自动生成长期记忆。
- 审批只接受已完成规划的 awaiting_approval，并 validatePlan；拒绝计划零外部调用。各 mutation 验证 version，advance 独占 180 秒租约，开始任务或预留模型用量先落盘，再调用供应商。返回时同时检查租约与版本，stop/pause 清租约，迟到结果不能增加证据、写报告或恢复运行；finally 只释放自己的租约。
- 用户暂停保持 paused/user_paused，并把正在执行工具标记为 failed。未审批规划暂停时 planning=false，保留计数/费用；按更新后的 brief，unapproved paused 可手动 replan，resume 仍仅限已审批研究。工具、规划、复核租约过期或落盘后租约丢失都保守暂停/失败，必须明确 resume/replan，不自动重发。旧模型补账与新规划并发造成版本失配时，新规划也保守失败，避免静默第三次调用。

## 限制与会计

请求体使用流式 UTF-8 严格读取，最多 16384 字节，必须是 JSON 对象；mutation（包括 DELETE）要求 `X-Buddy-Client: workbench` 和 application/json。拒绝 cross-site 和不匹配 Origin，无 CORS。所有响应使用 no-store，统一中文公开错误，不返回原始异常、配置、密钥或模型推理。

SQLite 持久化限流为 GET 60/min/owner、mutation 40/min/owner、登录分别 IP 与 owner 8/15min、live 创建 6/hour/owner；固定窗口按 repository 实现，测试验证阻断与下一窗口恢复。

每个模型请求先检查单研究剩余费用、累计调用次数与含暂停时间的累计运行时长，再预留全站 UTC 日账本，随后将 modelCalls+1 和保守预留费用保存到研究。规划未审批也照常收费，未调用 `recordModelUsage` 绕过审批规则。成功按 actual 替换预留并累加 token；失败或 usage 未知保留保守费用并标记 unknown。模型解析/引用错误仍收费且不能伪造 completed。

最终默认规划 max_output_tokens=3000，复核 max_output_tokens=12000；engine 从实际 payload 读取值计算 `modelReservation`。维持 high 推理、最多四次模型调用（含失败）、单研究最多 $0.50、全站日最多 $5、模型请求 120 秒、研究累计 900000ms。环境费用配置只能收紧；恢复和重新规划不重置用量。迟到模型也结算日账本，终态仅允许补用量；研究补账 CAS 至多一次，若与其他用户操作再次竞争，仍保留已记的保守研究费用，日账本已记录真实费用。

工具 beginTask 先保存。暂时性 ProviderError 按 retryAfterMs 且不早于一秒设置 retryAt，三次总尝试，必须用户明确恢复；永久鉴权、无效数据和未预期异常不重试。证据成功须经过 succeedTask 校验，完整 raw 保存在 repository；超大或不可安全保存证据转为明确失败，不假装成功。报告只能经 buildResearchReport/completeRun/validateReport 校验后完成和导出。

## 红绿与最终验证

均在正式目录运行。判据：测试进程退出码为 0、fail=0，且断言检查真实 SQLite 保存的证据、CAS、用量、引用及公开返回；typecheck/ESLint 退出 0 且无诊断。

初始红：`node --experimental-strip-types --test tests/server.test.ts`，9 项失败，退出 1，均明确断言“服务入口尚未实现”；实施后 demo 主链路 9/9。首次导出测试曾错误地将公开导出证据摘要用于原始事实验证，按既有 exportReport 契约修正为 SQLite 完整原始证据验证和导出引用一致性断言，没有修改 report 模块。

容量红：`node --experimental-strip-types --test tests/model.test.ts`，10 通过/1 失败，退出 1，2200 !== 6000；修改额度后 11/11。最终额度由主代理实测修正至 12000，同一容量断言和服务预算测试也使用最终值。

追加回归先红后绿：规划用户暂停、复核/工具超期、父研究上下文、旧模型补账和新规划并发、丢失租约、UTF-8 附件参数。失败具体表现分别为错误状态、上下文缺失、planning 未清理、请求不能恢复及附件编码未满足断言；修复后本地服务 22/22。

最终命令及实际结果：

1. `node --experimental-strip-types --test tests/server.test.ts tests/model.test.ts`：退出 **0**；**33 tests / 33 pass / 0 fail**，其中服务 22、模型 11。约 2.01 秒。
2. `npm run typecheck`：退出 **0**；`tsc --noEmit` 无诊断。
3. `node node_modules/eslint/bin/eslint.js lib/buddy/server.ts lib/buddy/engine.ts 'app/api/buddy/[...path]/route.ts' tests/server.test.ts`：退出 **0**，无诊断。

服务测试覆盖 demo normal 全部 18 个实际任务和报告完成、missing 的 null/unknown、failure 暂停恢复、不审批零调用、tighten 单工具不可重置、刷新一致、跨 scope、CSRF、显式记忆与删除、输入边界、延迟 stop/并发 advance、过期和丢失租约、同 owner 模式升降级、未审批规划的预留/actual/unknown 会计、单研究/每日预算前置阻断、四次模型总上限、停止后日账本结算、复核无效引用收费、用户规划暂停和手动 replan、父研究上下文与压缩保留、持久化限流、签名配置与伪造会话、流式大小和 UTF-8。

## 已知边界与待外部验收

本地 SQLite 和确定性演示验证不代替 Cloudflare D1 部署、真实浏览器或真实供应商完整工作流验收；这些由主代理完成。没有实现闭页面后台持续运行：当前有限请求可以返回一个检查点，重开工作台以后才继续下一步。

主代理提供的真实复核容量证据：2200 时 status=incomplete，input9843/output2200，估算 $0.0055929；6000 时仍截断，input9843/output6000，估算 $0.00996474；12000 时严格解析成功，五份真实证据、17 claims/4 facts、input9843/output8442，actual **$0.01289514**，35.7 秒，预留 **$0.0249717**。本子任务未独立联网复验，完整脚本/证据归主代理报告。

正式服务、路由、测试和报告已保存在 D 盘。本子任务没有创建 C 盘任务缓存，因此没有执行 C 盘清理。没有未解决的服务契约疑问。

## 2026-10-03 审查补充

修正父摘要整体 JSON 截断，以及全部工具完成后复核恢复被工具额度误挡两项 P2。新增四项回归，服务测试现为 26/26，typecheck 退出 0；精确红绿结果、范围和边界见同目录 `TASK_03C_FIX1.md`。此补充不改变此前记录的最终模型输出额度 12000 或模型/费用/运行时长上限。
