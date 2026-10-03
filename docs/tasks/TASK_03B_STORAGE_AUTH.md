# Task 03B · 持久存储与会话边界（唯一实施要求）
这是阶段3的存储子任务；数据/模型适配由主代理已实现。不要读取 .env.local/.dev.vars，不联网调用供应商，不改UI、Harness、provider、model、types、全局状态文档；不提交。所有正式文件在 D:/projects/THSwork/investment-x-buddy。

## 文件所有权
允许新建/修改 lib/buddy/auth.ts、lib/buddy/repository.ts、db/schema.ts、cloudflare-env.d.ts、tests/auth.test.ts、tests/repository.test.ts、tests/support/d1.ts、drizzle/*.sql 和 drizzle/meta/**（仅本次新生成尚未发布的迁移）。报告 docs/stages/TASK_03B_REPORT.md。
项目新目录有沙箱写入限制；普通写入若 EPERM，仅对明确命名项目文件使用 require_escalated，不修改 ACL 或外部配置。

## 会话函数 contracts
导入 Session/RunMode（lib/buddy/types.ts）。
- newSession(mode:RunMode,now:number):Session：随机UUID ownerId，expiresAt=now+7天毫秒。
- signSession(session:Session,secret:string):Promise<string>：HMAC-SHA256，base64url JSON payload.signature；secret长度>=32；payload最多1024字符；不得用非密码学随机或明文访问码作为令牌。
- verifySession(token:string,secret:string,now:number):Promise<Session|null>：签名、结构、mode、owner UUID、到期、最长TTL均校验；错误均返回null而不泄露细节；不可通过篡改mode提升到live。
- checkAccessCode(supplied:string,expected:string):Promise<boolean>：输入长度1..128，安全固定长度摘要比较/crypto.verify；空配置返回false，不允许trim导致另一访问码接受。
- sessionCookie(token:string,url:string):string：buddy_session，Path=/，HttpOnly，SameSite=Lax，Max-Age=604800，https加Secure（本地HTTP可用）。
- readSessionCookie(request:Request):string|null：只读取buddy_session，拒绝过长/重复冲突cookie。

此为访问码保护的个人原型，不搭建外部OAuth账户系统。不把会话数据本身当持久研究状态。

## Repository contracts
使用原始D1 prepare().bind().first()/all()/run() 与 batch()，每prepare仅一条SQL；不在运行时建表。允许定义结构兼容D1的小接口用于NodeSQLite测试。export class BuddyRepository，constructor(db:D1Database或兼容interface)。
export interface RunRecord {
 run:AgentRun; symbols:string[]; scenario:"normal"|"missing"|"failure";
 planning:boolean; reviewAttempts:number; retryAt:number; leaseId:string|null;leaseUntil:number;
}
export type RunSummary=Pick<AgentRun,"id"|"title"|"goal"|"mode"|"status"|"createdAt"|"updatedAt"|"metrics"|"version"> & {symbols:string[];planning:boolean};
方法：
- insert(record:RunRecord):Promise<void>，新run全局唯一ID；拒绝重复，不覆盖其他所有者。可以验证结构但不能要求run已approved。
- get(id:string,ownerId:string,mode:RunMode):Promise<RunRecord|null>：所有查询必须owner+mode隔离，完整恢复原始证据。
- list(ownerId:string,mode:RunMode):Promise<RunSummary[]>：最多30，updatedAt倒序，不返回raw或其他用户。
- save(record:RunRecord,expectedVersion:number,leaseId?:string):Promise<boolean>：CAS运行版本，record.run.version必须>expectedVersion；owner+mode必须匹配。提供leaseId时须当前租约匹配且保持租约；不提供时为用户控制写入并清除租约。原始证据新增与CAS保存以原子batch完成；冲突返回false，不覆盖或写入迟到证据。
- acquire(id:string,ownerId:string,mode:RunMode,now:number,leaseMs=180000):Promise<{record:RunRecord;leaseId:string}|null>：原子获取随机租约，当前未到期租约存在返回null；不修改AgentRun.version（仅调度锁）。不在此重置任务状态。max lease 180000，允许90秒等更小值。
- release(id:string,ownerId:string,mode:RunMode,leaseId:string):Promise<boolean>：只释放匹配租约，不更新运行版本。
- memories(ownerId:string,mode:RunMode):Promise<MemoryEntry[]>：最多50。
- addMemory(ownerId:string,mode:RunMode,entry:MemoryEntry):Promise<void>：长度<=2000，kind合法，最多50，不跨mode；id唯一，不覆盖。
- deleteMemory(ownerId:string,mode:RunMode,id:string):Promise<boolean>：owner+mode隔离。
- reserveBudget(day:string,amount:number,cap:number,token:string,ownerId:string,runId:string):Promise<boolean>：day=UTC YYYY-MM-DD，有限非负amount/cap。全站每日模型预算，不按浏览器区分；一条原子 INSERT...SELECT 根据当日所有reservation总占用判断（pending用预留amount，settled用actual）；token唯一。并发不能绕过cap；重复token返回false，不二次预留。
- settleBudget(token:string,actual:number|null):Promise<boolean>：仅pending可结算一次；actual未知(null)保留预留amount作为保守收费估计，不能释放未知费用。actual需finite>=0。
- budget(day:string):Promise<{spent:number;reserved:number}>：分别已结算和待结算。若实际高于预留保留真实actual，可能超预算时服务器下一次应拦截。
- rateLimit(key:string,windowMs:number,max:number,now:number):Promise<boolean>：固定时间窗计数，原子Upsert count仅<max可增加，超出返回false。

## Schema与大小
D1单行大小限制须防护。建议5表：buddy_runs（id PK、ownerId、mode、version、updatedAt、run JSON、symbols、scenario、planning、reviewAttempts、retryAt、leaseId/Until）；buddy_evidence（runId+id复合PK，owner/mode或通过run关联，完整Evidence JSON+hash）；buddy_memory；buddy_model_reservations；buddy_rate_limits。
主run JSON保存证据metadata/raw:null，get时从evidence表恢复完整raw；不能丢raw/metrics/series/哈希或引用关系。完整evidence每行<=900000 UTF8bytes；主run每行<=900000，超出显式报错且无部分写入。
证据ID在同一run中不可改写成不同内容；允许相同证据重复保存（幂等）。CAS保存与新增证据批次应保证失败时不插入迟到证据。可先条件INSERT evidence（WHERE run version=expected 且租约条件），再同batch UPDATE run（同谓词），保证不交错。单个操作有限最多25证据。
索引按owner/mode/updatedAt、run evidence读取、memory、budget day、rate key/window必要查询建立，不做无用索引。
Drizzle schema生成正式迁移 node D:/softwaretwo/node/node_modules/npm/bin/npm-cli.js run db:generate，检查schema-only bounded SQL，无seed，不依赖运行时CREATE。
Cloudflare.Env声明 DB及产品环境变量（全部string可选）：DEEPSEEK_API_KEY/BASE_URL/MODEL/REASONING_EFFORT、FUYAO_API_KEY、IFIND_API_KEY/MCP_BASE_URL、RESEARCH_ACCESS_CODE、SESSION_SECRET、MODEL_INPUT_USD_PER_MILLION、MODEL_CACHED_INPUT_USD_PER_MILLION、MODEL_OUTPUT_USD_PER_MILLION、RUN_BUDGET_USD、DAILY_MODEL_BUDGET_USD；保留BUCKET可选原有声明。

## 必要验证
先红后绿。Node24 node:sqlite.DatabaseSync内存数据库，D1兼容adapter实际执行SQL，batch用事务，测试assert真实查询结果；无供应商mock、无敏感环境。
测试：会话篡改mode/签名/过期/异常结构拒绝，合法cookie；owner及mode隔离；CAS冲突不写原始证据；停止/用户保存清除租约，旧租约迟到save失败；并发只获1租约；到期租约重新获取不改原run；原始raw及metric/hash reload一致；预算同时reserve不越cap、token不重复、未知费用不清零、只能结算一次；记忆增删/上限与隔离；限流窗口；大行防护。
命令 node --experimental-strip-types --test tests/auth.test.ts tests/repository.test.ts；完整 tsc不增修他人源码，报告问题。
报告记录实现、迁移名、红绿验证命令与判断标准、集成注意、未知，最终返回 status+一行结果+报告路径。
