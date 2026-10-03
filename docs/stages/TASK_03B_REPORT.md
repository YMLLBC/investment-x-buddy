# Task 03B：持久存储与会话边界实施报告

状态：完成本子任务。正式文件均在 `D:/projects/THSwork/investment-x-buddy`。未读取私密环境文件，未调用供应商，未提交代码，未修改 UI、server、Harness、types、model 或 provider。

## 实现与迁移

- `lib/buddy/auth.ts`：随机 UUID 所有者、7 天会话、HMAC-SHA256 签名、规范 base64url、严格结构与 TTL 验证；访问码采用 Web Crypto 验签比较，保留输入空白；HTTP 本地 cookie 与 HTTPS Secure cookie、重复冲突和过长 cookie 拒绝。
- `lib/buddy/repository.ts`：原始 D1 prepare/bind/first/all/run/batch 接口；所有运行、证据和记忆读取按 owner + mode 隔离。运行版本 CAS、条件证据 INSERT 与运行 UPDATE 同事务；证据内容冲突使 NOT NULL 约束失败并回滚全批。随机租约独占获取，最长 180 秒，支持更短租期；用户保存清除租约，旧 worker 无法回写。
- 证据完整 JSON 独立保存，主运行 raw 为 null；读取恢复完整 raw、metrics、series、hash。稳定键排序让内容相同的证据重复保存幂等；单操作最多 25 条证据，UTF-8 行大小保守限制 900000 字节，序列化预检查在任何写入前完成。
- 全站 UTC 每日预算采用单条条件 INSERT 汇总占用；唯一 token、防重复预留、仅 pending 可结算一次；未知费用沿用预留额，实际费用可超过预留额。记忆每 owner + mode 最多 50 条、全局唯一 ID；固定窗口限流原子 UPSERT。
- `db/schema.ts` 定义 5 表；`cloudflare-env.d.ts` 补齐产品可选字符串环境变量，保留 DB 和 BUCKET。正式迁移为 `drizzle/0000_brave_nicolaos.sql`，配套 `drizzle/meta/0000_snapshot.json` 与 `_journal.json`。SQL 检查结果：仅 CREATE TABLE/INDEX、复合主键和外键，无 seed、无运行时建表。

## 验证记录

执行目录：`D:/projects/THSwork/investment-x-buddy`；Node `v24.18.1`。

1. 红：`node --experimental-strip-types --test tests/auth.test.ts tests/repository.test.ts`，实现前 8 项断言失败，退出码 1。失败原因是会话和 Repository 实现尚不存在，符合本轮预期。
2. 迁移：`node D:/softwaretwo/node/node_modules/npm/bin/npm-cli.js run db:generate`。首次普通沙箱写 snapshot 报 EPERM（工具错误地返回退出码 0，因此未按退出码单独认定成功）；随后明确限定本项目 drizzle 产物的授权执行成功，生成上述正式文件。
3. 首轮实现：同测试命令 7 通过 / 1 失败。唯一失败为 Node SQLite 返回 null-prototype 对象，D1 适配器未转换普通对象；数据数值本身一致。适配器转换查询行形态，batch 使用同步事务执行避免 await 交错后再次验证。
4. 绿：同测试命令 8 通过 / 0 失败，退出码 0。测试真实使用 `node:sqlite.DatabaseSync(':memory:')`，实际应用生成迁移、运行 SQL、查询表数据断言；没有供应商 mock。
5. 类型：`node node_modules/typescript/bin/tsc --noEmit --incremental false`，退出码 0、无诊断。`git diff --check -- lib/buddy/auth.ts lib/buddy/repository.ts db/schema.ts cloudflare-env.d.ts tests/auth.test.ts tests/repository.test.ts tests/support/d1.ts drizzle` 无空白错误；仅已有 Git LF/CRLF 提示。

通过标准：全部测试 0 失败且类型检查退出 0；任一越权读取/写入、CAS 冲突落库、旧租约回写、预算超预留上限、未知费用归零或证据丢失均视为失败。

测试覆盖：签名/mode 篡改、过期、异常结构、UUID、最长 TTL、短密钥和 cookie 边界；owner/mode 查询与保存隔离、重复运行 ID；原始证据/指标/序列/hash 回读；CAS 冲突无新增证据、证据不可改写及全批回滚、重复保存幂等；8 个同时请求仅 1 个获得租约、90 秒期限与超长拒绝、到期重获不改 AgentRun、停止保存清租约与旧 worker 失败；20 次同时预算预留最多 4 次成功、token 去重、未知/超预留实际费用、一次结算；记忆上限及增删隔离、限流窗口；超大 UTF-8 行及 26 证据拒绝无部分写入；列表限制 30 条且倒序。

## 集成注意与未知

- `BuddyDatabase`/`BuddyStatement` 为可被 D1Database 结构兼容的接口；测试适配器仅用于本地 SQLite。所有单个 prepare 只有一条 SQL；批次原子性依赖 D1 batch 事务契约。
- 调度租约不修改 AgentRun.version；worker 保存必须传 acquire 返回的 leaseId。用户控制保存不传 leaseId，并使用当前版本作为 expectedVersion。版本冲突返回 false；结构、大小及不可变证据冲突抛错。
- budget 是全站每日汇总；服务端下一次调用前需要同时考虑 spent + reserved。settleBudget 的 null 表示未知费用，保留预留收费估计。
- 记忆达到 50 条或 ID 冲突时 addMemory 抛错，删除返回布尔值。访问码及 SESSION_SECRET 配置由 server 提供，不在此模块读取环境。
- 尚未执行远程 D1 部署、真实多地域并发压测或生产供应商调用。本报告的并发验证为同一真实 SQLite 实例的 Promise 同时调度，证明 SQL 原子谓词及事务结果，不能替代云端压力测试。
- D 盘正式文件与迁移已确认存在；本子任务没有创建 C 盘缓存，无需清理。

## 独立审查修订：限流乱序与 raw 哈希回读

本节更新前文的初次实现结论。已读取 `docs/reviews/TASK_03B_REVIEW.md` 和原始 brief；仅修改 `lib/buddy/repository.ts`、`tests/repository.test.ts` 并追加本报告，未提交，也未修改其他模块或迁移。

### 已确认问题及修复

- 限流：原 UPSERT 将任何不同窗口均视为可以重置计数，迟到请求会把当前窗口回退。现在 SQL 仅允许推进到更大 window_start；相同窗口按上限累加；较早窗口返回 false 且不改变当前记录。不增加表或迁移。
- 原始证据：原 canonical 递归排序改变 raw 对象键序，而现有 `data.ts` 的 sha256 对 `JSON.stringify(raw)` 求摘要。真实回归确认 `{ z: 1, a: { z: 2, a: 3 }, rows: [{ z: 4, a: 5 }] }` 回读后的摘要由 `da97beedc602d9929af10e29e9029029dc79583853db73168267203d23a356e4` 变为 `afc18223d3dabd8a061b816581cfa10fa3ec82d6f9221d1cb179fe19a78d4215`。现在完整 Evidence 使用原序 JSON.stringify 保存，保留 raw 全层级键序，未修改 data.ts。
- 前文“稳定键排序”描述已失效：目前幂等判断使用保存的完整 JSON 字节序和 hash；相同证据原序重复保存仍幂等。重新排列键序的同 ID 输入按不可变内容冲突保守拒绝。旧实现已经重排保存的数据不会被此次代码变更自动还原原键序。

### 新增红绿验证与判断标准

命令均在项目目录执行：`node --experimental-strip-types --test tests/auth.test.ts tests/repository.test.ts`。

1. 仅新增乱序回归，未修改实现：9 项中 8 通过、1 失败，退出 1；输入 now 为 `[1000,1000,999,1001]`，windowMs=1000、max=2，实际 `[true,true,true,true]`，期望 `[true,true,false,false]`。
2. 再新增真实 sha256 回读回归，未修改实现：10 项中 8 通过、2 失败，退出 1；第二项明确报告上述两个摘要不一致。
3. 仅修正限流 SQL 后：10 项中 9 通过、1 失败，退出 1；乱序项通过，哈希项仍失败，验证两项问题相互独立。
4. 移除证据排序后：10 项全部通过、0 失败，退出 0。原 8 项保留；新增两项均使用真实 SQLite 和现有 sha256 函数，没有供应商或网络请求。

限流通过标准：上述四次结果必须为 `[true,true,false,false]`，数据库窗口保持 1000、计数保持 2；随后同时调度 `[2000,1999,2001,1998,2002]` 应为 `[true,false,true,false,false]`，数据库窗口推进到 2000、计数为 2。哈希通过标准：insert 和 CAS save 新增证据后，读取的 JSON.stringify(raw) 与原始字符串一致，重新计算的 sha256 与原 hash 相同，所有历史回归仍通过。

本轮完整类型检查命令：`node node_modules/typescript/bin/tsc --noEmit --incremental false`。实际退出 1，诊断为 `lib/buddy/client.ts(11,36)` 和 `(11,65)` 的 TS2339：空对象类型上不存在 error 属性。没有本子任务修改文件的诊断；未越权修改 client.ts，已反馈主代理处理。初次报告中的类型检查通过对应修订前那次执行，不能用来声称当前整个项目类型检查通过。

当前状态：本子任务两项审查缺陷已修复且 10/10 回归通过；全项目类型检查仍受上述外部文件问题阻塞。正式报告已追加保存在 D 盘；无 C 盘缓存需要清理。

## 第二轮修订：metadata 键序无关的证据幂等

已读取 `docs/reviews/TASK_03B_REREVIEW_1.md`。复审指出的 P2 已复现：Evidence 各字段和值相同，仅反转 metadata 键序且 raw JSON 字节/hash 不变时，原序整份 JSON 字节比较错误触发 NOT NULL，阻止合法 CAS 保存。

本轮仅更新 repository、repository 测试与本报告，不改 data.ts、hash 算法、schema 或 migration，不提交。新增 `canonicalMetadata` 递归稳定排序 metadata 对象键，并保持数组元素顺序；序列化 Evidence 时先拆出 raw，metadata 规范化完成后原样放回 raw。因此排序递归不会访问 raw 子树，保留它所有嵌套对象与数组对象的键序。相同 metadata 重排后的保存生成相同 evidence_json；既有 SQL 幂等分支继续保留已存证据内容。真实 metadata 值改变仍触发整批回滚。

本节取代前一修订中“metadata 重新排列键序也保守拒绝”的行为说明。当前只对 metadata 规范化，不重新排序或重算 raw；raw JSON 字节/hash 的不可变边界维持原要求。

红绿命令：`node --experimental-strip-types --test tests/auth.test.ts tests/repository.test.ts`，在项目目录执行。

- 红：先追加 metadata 重排回归，保留原 10 项；实际 10 通过 / 1 失败，退出 1。失败为 `NOT NULL constraint failed: buddy_evidence.evidence_json`，发生在同一证据的合法 CAS 保存。
- 绿：完成 metadata 专用规范化后，同命令 11 通过 / 0 失败，退出 0。原 10 项全部保留并通过，包括原始 raw 键序与真实 SHA-256 回读检查。
- 全量类型：`node node_modules/typescript/bin/tsc --noEmit --incremental false`，本轮退出 0、无诊断。先前 client.ts 外部类型错误在本轮执行时已不再出现；本子任务未改该文件。

新增回归通过标准：反转 Evidence 顶层键、metrics 对象键和 series 对象键后，与原证据 deepEqual 且 raw JSON 字节相同；save 返回 true、版本到 1；完整证据回读内容一致、raw JSON 字节和原 sha256 不变；数据库已存 evidence_json 字符串不被重写；随后真正更改 title 必须回滚且版本保持 1。真实 SQLite 执行结果全部满足。

最新状态：第二轮 P2 已修复，11/11 回归与全量 tsc 通过。部署与远程 D1 验证边界维持前文；正式文件均在 D 盘。
