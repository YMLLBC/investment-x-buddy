# Task 03B 限定复审 1

日期：2026-10-02。修正提交：`ba559b3`。审查材料：原任务 brief、原审查报告、`TASK_03B_FIX_PACKAGE.diff` 与实施报告追加红绿记录。复审限定于原两项问题及修正 diff 引入的新问题；未复审外部 `client.ts`，未改源码、未联网、未读取密钥、未提交。

## Verdict

- **Spec compliance：不通过。** 原问题均已处理，但修正引入 1 个 P2：相同证据仅 metadata 对象键序不同就触发内容冲突，不满足原 brief 的重复保存幂等要求。
- **Task quality：需要修改。** 两条新增回归覆盖了原触发场景；尚缺独立于 raw 字节顺序的 evidence metadata 幂等覆盖。

## 原问题逐项复审

1. **原 P1：回读 raw 与原哈希不一致 — ADDRESSED（已处理）。** `lib/buddy/repository.ts:31-32` 用原序 `JSON.stringify(e)` 替代递归排序，`hydrate` 不再收到重排 raw。`tests/repository.test.ts:107-122` 覆盖非排序 raw、嵌套对象、数组对象的 insert/get 和 CAS save/get，通过现有 `sha256` 校验原 hash；未改 data.ts。实施报告记载原实现失败、修正后通过。旧实现已损坏的历史数据不能自动恢复，追加报告已明确披露；该未发布任务未要求迁移修复历史数据。
2. **原 P2：较旧窗口请求重置当前限流计数 — ADDRESSED（已处理）。** `lib/buddy/repository.ts:112-113` 仅允许向更大窗口推进，同窗按上限累加，更旧窗口不满足 UPDATE 条件。`tests/repository.test.ts:95-105` 断言 `[1000,1000,999,1001]` 返回 `[true,true,false,false]`，窗口及 count 不回退；亦覆盖推进后的交错时间窗请求。未改变预算、CAS、租约 SQL。

## 修正 diff 新问题

### [P2] evidence 顶层 metadata 键序变化被误判为不可变内容冲突

**位置：** 修正行 `lib/buddy/repository.ts:32`；与保留的 `lib/buddy/repository.ts:69` 整份 `evidence_json` 字节相等条件组合触发。

**事实与触发场景：** 删除 canonical 后，存储完整 evidence 正确保留 raw 字节，但幂等比较同时变成对整个 Evidence 的对象键顺序敏感。调用者用相同字段和值重新构造 Evidence，仅调整顶层 metadata 的排列顺序，raw 的 `JSON.stringify` 字节和 hash 都不变、对象 deepEqual 成立，仍触发 NOT NULL 约束并回滚合法 CAS 保存。这里没有重排 raw，也没有改变证据内容或摘要。

**影响：** 合法的重复证据重建会阻止整个 run 保存；违反原 brief“允许相同证据重复保存（幂等）”。追加实施报告披露的“重新排列键序按不可变内容冲突拒绝”不能替代这一 contract，尤其是与 raw 哈希无关的 metadata 键序。

**独立新增探针：** 未重跑既有 10 项测试。以下命令在项目目录执行，使用真实 SQLite、现有 sha256、内存数据库和当前迁移：

```powershell
@'
import { BuddyRepository } from './lib/buddy/repository.ts';
import { sqliteD1 } from './tests/support/d1.ts';
import { sha256 } from './lib/buddy/data.ts';
import assert from 'node:assert/strict';
const { db, sqlite } = sqliteD1();
const repo = new BuddyRepository(db);
const raw = { z: 1, a: 2 };
const evidence = { id: 'e', title: 'e', provider: 'fixture', sourceUrl: '', retrievedAt: '', asOf: null, unit: '', scope: '', quality: 'valid', summary: '', raw, hash: await sha256(raw) };
const run = { id: 'r', ownerId: 'owner', mode: 'demo', version: 0, updatedAt: '', evidence: [evidence] };
const record = { run, symbols: [], scenario: 'normal', planning: false, reviewAttempts: 0, retryAt: 0, leaseId: null, leaseUntil: 0 };
await repo.insert(record);
const reordered = Object.fromEntries(Object.entries(evidence).reverse());
assert.deepEqual(reordered, evidence);
assert.equal(JSON.stringify(reordered.raw), JSON.stringify(evidence.raw));
record.run = { ...run, version: 1, evidence: [reordered] };
try { console.log(JSON.stringify({ saved: await repo.save(record, 0) })); }
catch (error) { console.log(JSON.stringify({ semanticEquality: true, rawBytesIdentical: true, saveError: error.message, version: (await repo.get('r','owner','demo')).run.version })); }
sqlite.close();
'@ | & 'D:\softwaretwo\node\node.exe' --experimental-strip-types --input-type=module -
```

上述最小运行时探针仅保留所需 run 字段。命令退出 0，实际输出 `semanticEquality=true,rawBytesIdentical=true,saveError="NOT NULL constraint failed: buddy_evidence.evidence_json",version=0`。判断标准：只重排顶层 metadata、raw 字节和 hash 不变时应返回 `saved=true` 且版本为 1；同时内容真实变化仍应回滚。**当前新案例验证失败。**

**修复方向：** 将完整原序 JSON 的存储与幂等内容比较分开；metadata 可进行规范化比较，而 raw 仍须保留原 JSON 字节与 hash 关系。成功幂等保存不应覆盖已存证据原序内容。可在本任务 repository/schema 所有权范围内选择实现；不得改供应商模块或重算 hash 掩盖原始证据变化。补充 metadata 重排且 raw 不变的回归覆盖，保留原 10 项测试。

## 验证边界

事实：静态检查修正提交内容与新增测试；实施报告记载两项原问题先红后绿、最终 10/10 通过，旧 8 项保留。本轮没有重复执行这些测试，只运行上述新增幂等探针。报告中的外部 client.ts 类型诊断按主代理说明已处理，非本轮 diff，未独立验证也不作为本轮缺陷。

未知：远程 D1 与后续 service 的鉴权、预算调用及记忆显式确认仍不在限定复审范围。正式报告位于 D 盘，本轮无 C 盘缓存。
