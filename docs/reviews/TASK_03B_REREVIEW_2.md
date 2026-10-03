# Task 03B 限定复审 2

日期：2026-10-02。修正提交：`7163acb`。审查对象：`TASK_03B_FIX2_PACKAGE.diff`、对应 repository 与新增回归、`TASK_03B_REPORT.md` 追加证据。限定检查上一轮 metadata 幂等 P2 是否处理，以及本次 diff 的新增破坏；未改实施源码、未联网、未读密钥、未提交。

## Verdict

- **Spec compliance：通过（限定复审范围）。** 上轮 P2 已处理，原 raw/哈希一致性与同 ID 证据重复保存幂等可同时满足；本次 diff 未发现新的明确 contract 违反项。
- **Task quality：通过（限定复审范围）。** metadata 规范化与 raw 原序存储边界清晰；新增回归验证合法幂等、已存内容不改写和真实内容冲突回滚，未削弱原 CAS/租约/预算实现。

## 逐项结论

**上一轮 P2：metadata 键序变化被误判为证据内容冲突 — ADDRESSED（已处理）。**

- `lib/buddy/repository.ts:26-32` 仅对传入 metadata 稳定排序对象键，保留数组元素顺序；因此顶层 metadata、metrics 和 series 内对象重排仍产生同一 JSON。
- `lib/buddy/repository.ts:33-36` 在递归之前拆出 raw，规范化结束后原样放回。raw 所有嵌套对象与数组对象均不进入排序递归，现有 `SHA-256(JSON.stringify(raw))` 哈希输入不变。
- `lib/buddy/repository.ts:43` insert/save 共用该序列化路径。既有 SQL 相等分支保留已存 evidence_json；metadata 真正改变仍进入约束失败分支并整批回滚，未改 CAS 或租约谓词。
- `tests/repository.test.ts:124-147` 增加原触发场景：反转 Evidence 顶层键及 metrics/series 对象键，保持 raw 字节不变；要求 save 成功、版本推进、回读内容及原 SHA-256 一致、已存 JSON 字符串不变。随后改变 title 要求失败且版本不变，覆盖不可变内容边界。

原 raw/哈希 P1 和限流乱序 P2 在上一轮已标记 ADDRESSED；本次 diff 未改动限流，raw 明确排除在规范化递归之外，未发现这些修正被撤销。**新增问题：无。**

## 验证依据与边界

事实：本轮检查修正 diff、提交统计、当前实现与新增测试断言；实施报告记载新增回归先红（10 通过 / 1 失败，NOT NULL 约束），修正后同命令绿（11 通过 / 0 失败），原 10 项均保留。报告亦记载全量 tsc 退出 0、无诊断。

可执行验证命令为 `node --experimental-strip-types --test tests/auth.test.ts tests/repository.test.ts` 与 `node node_modules/typescript/bin/tsc --noEmit --incremental false`，执行目录为项目根目录。通过标准是 11 项零失败、类型退出 0，并满足上述幂等与真实冲突断言；本轮遵照限定复审要求未重复执行已覆盖测试或 tsc，不将报告中的执行结果冒称为本轮独立执行结果。

未知：远程 D1、多地域调度、已发布旧数据的兼容迁移及后续 service 集成不在本次修正 diff 范围，未新增验证。此 verdict 仅针对当前未发布任务实施及修正，不代表生产部署已验证。

正式报告位于 D 盘，本轮无 C 盘缓存。
