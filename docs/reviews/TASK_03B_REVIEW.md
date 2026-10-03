# Task 03B 持久化与鉴权独立审查

审查日期：2026-10-02。限定范围：`docs/tasks/TASK_03B_STORAGE_AUTH.md`、`docs/stages/TASK_03B_REPORT.md`、`docs/reviews/TASK_03B_PACKAGE.diff` 及对应实现、迁移、测试文件。未读取私密环境、未联网、未修改实施源码、未提交。

## Verdict

- **Spec compliance：不通过（1 个 P1、1 个 P2 待修复）。** 回读证据的 raw 与原哈希关系被破坏；固定时间窗限流在请求乱序时不保持每窗计数上限。
- **Task quality：需要修改（1 个 P1、1 个 P2）。** CAS 与证据新增同批事务、租约隔离、预算原子预留及保守结算有明确实现与测试依据；测试的 deepEqual 不能检测 raw 的 JSON 字节顺序改变，限流测试遗漏跨窗口乱序场景。

## 问题

### [P1] 递归排序原始证据使回读 raw 无法匹配原哈希

**位置：** `lib/buddy/repository.ts:27-29,36`（`canonical` 与完整 evidence 的存储）；哈希集成依据为 `lib/buddy/data.ts:10,45`，仅为只读参考，未修改该模块。对应测试缺口位于 `tests/repository.test.ts:10-14` 的 roundtrip deepEqual 断言。

**事实：** 现有数据模块使用 `SHA-256(JSON.stringify(raw))` 生成证据哈希，并保留原 raw。Repository 对整个 evidence 递归排序，因此 raw 中的对象键顺序也改变；hydrate 回读排序后的对象，但 hash 保留原值。结构 deepEqual 仍能通过，却不能证明按现有哈希协议复核一致。这违反任务要求的“完整恢复原始证据”和“不丢 raw/哈希或引用关系”。

**触发场景与影响：** 供应商 JSON 对象只要含有原顺序非字典序的键（最小例 `{z:1,a:2}`），insert/save 后回读的 raw 重新哈希就与保存的 hash 不同。嵌套对象同样受影响。常规持久化即改变了证据的哈希输入，破坏回读证据完整性核验。

**独立验证：** 在项目目录执行以下 PowerShell 命令，使用真实 SQLite 与现有 sha256；无联网和供应商调用：

```powershell
@'
import { BuddyRepository } from './lib/buddy/repository.ts';
import { sqliteD1 } from './tests/support/d1.ts';
import { sha256 } from './lib/buddy/data.ts';
const { db, sqlite } = sqliteD1();
const repo = new BuddyRepository(db);
const raw = { z: 1, a: 2 };
const hash = await sha256(raw);
const evidence = { id: 'e', title: 'e', provider: 'fixture', sourceUrl: '', retrievedAt: '', asOf: null, unit: '', scope: '', quality: 'valid', summary: '', raw, hash };
const run = { id: 'r', ownerId: 'owner', mode: 'demo', version: 0, updatedAt: '', evidence: [evidence] };
await repo.insert({ run, symbols: [], scenario: 'normal', planning: false, reviewAttempts: 0, retryAt: 0, leaseId: null, leaseUntil: 0 });
const loaded = (await repo.get('r', 'owner', 'demo')).run.evidence[0];
console.log(JSON.stringify({ before: JSON.stringify(raw), after: JSON.stringify(loaded.raw), storedHashUnchanged: loaded.hash === hash, original: hash, reloaded: await sha256(loaded.raw), hashMatchesReloadedRaw: loaded.hash === await sha256(loaded.raw) }));
sqlite.close();
'@ | & 'D:\softwaretwo\node\node.exe' --experimental-strip-types --input-type=module -
```

此为仅保留本问题所需字段的最小运行时探针。命令退出 0，实际 `before={"z":1,"a":2}`、`after={"a":2,"z":1}`、`storedHashUnchanged=true`、`hashMatchesReloadedRaw=false`。原哈希为 `c5c2b1fdd0d4a83cda3ff79c9c74f2c72e2a92920afda20bcafc90c1a72f86a9`，回读 raw 哈希为 `c2985c5ba6f7d2a55e768f92490ca09388e95bc4cccb9fdf11b15f4d42f93e73`。判断标准：最后一项必须为 `true`，原 JSON 哈希输入应保持一致；**当前验证失败。**

**修复方向：** 存储完整 evidence 时保留 raw 原 JSON 键顺序；若需幂等比较，可独立进行规范化比较，不能以规范化结果替换原始持久内容。不要重新计算 hash 掩盖原始证据的改变，也不要修改供应商模块。增加非排序 raw（含嵌套对象）insert/save/get 后 `sha256(loaded.raw)===loaded.hash` 的回归验证。

### [P2] 较旧窗口请求可重置当前窗口限流计数

**位置：** `lib/buddy/repository.ts:116`（`rateLimit` 的 UPSERT）；对应覆盖缺口位于 `tests/repository.test.ts:80-81`。

**事实：** 冲突分支使用 `window_start<>excluded.window_start` 作为无条件允许更新的条件。任何不同窗口，包括更早的窗口，都会覆盖当前 `window_start` 并将 `count` 设为 1。因此 `now` 非单调时可反复重置计数。

**触发场景与影响：** 请求 A 在旧窗口获取服务器时间后等待数据库；新窗口请求 B、C 先落库并耗尽配额；A 随后落库把记录退回旧窗口；下一条新窗口请求 D 再把计数重置为 1。即使每条 SQL 都是原子的，新窗口仍超过 `max`。在多 worker、跨时间窗请求乱序或服务器时钟回退时均可触发；调用者无需控制服务器时间。

**独立验证：** 使用真实 `node:sqlite` 内存数据库及本任务迁移，不重跑已有 8 项测试。在项目目录执行以下 PowerShell 命令：

```powershell
@'
import { BuddyRepository } from './lib/buddy/repository.ts';
import { sqliteD1 } from './tests/support/d1.ts';
const { db, sqlite } = sqliteD1();
const repo = new BuddyRepository(db);
const results = [];
results.push(await repo.rateLimit('boundary', 1000, 2, 1000));
results.push(await repo.rateLimit('boundary', 1000, 2, 1000));
results.push(await repo.rateLimit('boundary', 1000, 2, 999));
results.push(await repo.rateLimit('boundary', 1000, 2, 1001));
console.log(JSON.stringify({ results, stored: sqlite.prepare('SELECT * FROM buddy_rate_limits').get() }));
sqlite.close();
'@ | & 'D:\softwaretwo\node\node.exe' --experimental-strip-types --input-type=module -
```

实际输出为 `results=[true,true,true,true]`，最终记录为 `window_start=1000,count=1`，命令正常执行退出 0。判断标准：同一 `[1000,2000)` 窗口已有两次成功后，最后一次必须返回 `false`，计数必须保持 2；旧窗口请求可按明确策略拒绝或独立计数，但不得退回并覆盖新窗口。**当前行为违反此标准，验证失败。**

**修复方向：** 同配置下仅允许向后续窗口推进，拒绝覆盖较新窗口的迟到请求；或使用 `(key, window_start, window_ms)` 作为独立计数身份。新增确定性的跨窗口乱序回归覆盖。修复实施与设计选择由主代理处理，本次不改源码。

## 已核对的约束

- 会话：密码学 UUID、HMAC-SHA256、规范 base64url、结构/mode/owner UUID/到期/最长剩余 TTL 检查；异常验证返回 null；访问码不 trim，通过 Web Crypto 验签；cookie flags、长度与冲突拒绝。包内测试会话 secret 为明确的合成 fixture，未发现本任务新增真实密钥或密钥日志。
- 持久化：运行及记忆查询带 owner + mode；证据读取通过运行关联隔离；新 run ID 不覆盖；save 版本递增与 owner/mode/CAS/lease 谓词一致；证据写入及运行更新同 batch；用户保存清除租约，旧 worker 的匹配条件失效；acquire/release 不修改运行版本。证据独立保存机制存在，但回读 raw/哈希一致性有上述 P1。
- 预算：单条条件 INSERT 汇总全站同日 reservation；token 唯一；pending 只能结算一次；null actual 沿用预留额；实际超预留仍真实累计；运行重试或版本写入不会清除预算表。后续 service 仍须每次调用预留及考虑 spent + reserved。
- 数据边界：每行预检查 900000 UTF-8 字节、最多 25 证据；不可变证据内容冲突触发 batch 回滚；5 表及必要索引，迁移无 seed、运行时无 CREATE；环境变量为可选字符串声明。记忆显式确认属于后续 service 集成，不判为本任务遗漏。

## 证据与未知

事实：实施报告记载测试 8/8 与 tsc 通过；本审查静态核对测试及适配器，按授权未重复执行相同测试。独立针对性探针运行了上述 raw/哈希和限流案例。

未知：远程 D1 部署、多地域调度及未来 service 鉴权、记忆确认和供应商预算调用流程尚未验证。报告中的“未发现”限于本任务实施包，不能作为后续集成的验证结论。

正式报告保存在 D 盘；本次未生成 C 盘缓存。
