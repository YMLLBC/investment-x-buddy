# Task 03C 服务编排
面向投资研究工作台，依赖已实现 Harness/auth/repository/model/providers/demo/data/report。允许新增 lib/buddy/server.ts、lib/buddy/engine.ts、app/api/buddy/[...path]/route.ts、tests/server.test.ts 和 docs/stages/TASK_03C_REPORT.md；2026-10-02 22:39经真实集成探针补充允许只改lib/buddy/model.ts的review输出容量与tests/model.test.ts的对应容量回归，其余模型逻辑不动。不得改其他模块/类型/前端/全局文档/密钥或提交。正式D:/projects/THSwork/investment-x-buddy；当前 unrestricted，无 sandbox_permissions。
先阅读依赖源文件，接口以源码为准。先红后绿，使用 tests/support/d1.ts 真 SQLite adapter；演示为实际确定性数据实现，不调用供应商。禁止联网/读.env密钥。本子任务只实现纯服务并测试，外部真实验收由主代理负责。

## 服务入口与响应契约
export type BuddyEnv = Record<string,string|undefined> & {DB?: BuddyDatabase}（可换合法结构，不允许DB强制冲突string索引）；export async function handleBuddy(request:Request,env:BuddyEnv):Promise<Response>。内部纯 engine 与 repo，不能在纯模块导入CF。route.ts GET/POST/DELETE 导入 env from cloudflare:workers 并handleBuddy（环境声明已有，可合理cast）。
统一 JSON {error:{code,message}} 错误，中文公开message，禁原始异常/配置/钥匙/推理。Cache-Control:no-store。GET限60/min owner；mutation限40/min owner；登录尝试IP+owner限8/15min，创建live限6/hour owner。请求体<=16KB流式读取，JSON对象严格字段类型。Mutation必须 X-Buddy-Client:workbench 且content-type application/json（DELETE也可{}），存在Origin须URL.origin相同，拒绝CrossSite；无CORS。

session signed HttpOnly buddy_session，GET bootstrap无session创建demo，secret缺失拒配置不是硬编码secret。POST session {accessCode:string} 校验私密RESEARCH_ACCESS_CODE后在同一owner升级live，expiresAt刷新7天；{mode:"demo"}降级，不删除已有ownedlive数据。sessionlive可以通过mode=demo访问自己的demo数据，sessiondemo不可mode=live。mode所有API显式query参数必需demo/live，bootstrap也支持demo默认。不可借ID跨owner/mode访问。响应session只{mode,expiresAt}，不返回owner。
GET bootstrap?mode=... 返回 {session,runs:RunSummary[],memory:MemoryEntry[],tools:ToolDefinition[],limits:DEFAULT_LIMITS,capabilities:{liveAvailable:boolean},dailyBudget?:{spent,reserved,cap}}。liveAvailable是所有模型+金融keys+访问码+签名secret存在且DB可用；真key不返回。tools按curatedTools。
POST runs?mode=.. body{goal:string<=2000,symbols:string[]1..3去重准确6位.SH/SZ/BJ,scenario?normal/missing/failure,requestId:UUID,parentId?:UUID,limits?:Partial<RunLimits>}。
创建 id=requestId，幂等已有ownedrun返回已有记录，同ID他owner存在须409不可覆盖。createRun未审批，demo demoPlan有限示例3符号，title简短根据goal，plan validatePlan。live预规划占位一条fuyao_search任务不执行，planning:true；真实规划下一次advance，前端自动触发。限制只tighten并在run预算中保留。显式确认记忆在create快照，对parentId检查sameowner/mode并将父研究摘要绑定contextSummary，不自动写长期memory。返回RunView结构，HTTP201新建。
GET runs/:id 和各mutation响应 RunView = {run:AgentRun(去ownerId,evidence中raw:null),symbols,scenario,planning,retryAt,executing:boolean,comparison:FinancialComparison}。
executing = 未过期租约，不公开leaseId。planning:true与awaitingapproval占位应前端显示规划中，不允许审批；规划失败planning:false且failed/unapproved提供replan。
POST runs/:id/approve {approved:boolean,version:number} 必须未planning+awaiting_approval，validatePlan，approveRun；CAS需version匹配。拒绝计划statusstopped无externalcall。
POST runs/:id/advance {version:number} 一次有限任务或planning/review； acquire唯一180秒lease，已租约返回409busy，version不匹配409。begin操作及usage预留先落盘，等待外部后CAS+lease+version防迟到覆盖；始终释放自己租约finally。stop/pause用户操作会清lease，迟到返回当前view，不能写新证据或report/恢复状态。
POST pause/resume/stop {version:number}：pause允running或规划租约中（planning取消或恢复需明确，不能伪造已规划完成），addEvent 保留progress，statuspaused stopReason user_paused，重置正在跑任务为failed可resume；不能已终态改。resume仅approvedpaused/failed且 retryAt<=now；core.resumeRun不得预算重置。stop core.stopRun对未审批也可停止，planningfalse，不删已证据。不同version409。
GET过期lease中run中的runningtask不自行再次执行：advance检测过期后把runningtaskfailTask transient + paused，用户明确resume恢复；规划中失联则保守failed/unapproved/replan；不无限卡planning。复核模型中失联亦paused。
POST replan {version} 仅unapprovedfailed/awaiting/paused（用户暂停规划也可手动继续规划），保留计数费用/历史事件，无预算重置，新planning:true并awaiting_approval；advance再次planning；最多4modelcalls包括failattempt。
GET runs/:id/evidence/:eid 返回Evidence完整raw（脱敏已有provider），不存在404。
GET runs/:id/export?format=markdown|json 完成后exportReport，仅owned；附件头UTF8合法。
POST memory {text<=2000,kind:preference|research,confirmed:true} 显式确认required，server随机UUID时间，max50；GETmemory，DELETEmemory/:id；响应{memory}。
错误边界Budget/Invalidstate/Version中文公开；不能未经报告验证给completed。

## 执行与预算
engine recibeenv/repo/record，真实Tool使用executeTool，只curatedschemas。demo executeDemo不网络、不模型、零tokenUSD；normal/missing/failure都完整实际pipeline。
Live planning planningPayload→modelReservation(...,3000)→globalreserveBudget UTC $5（env可收紧且不能超过5），run剩余预计费用先判；总4modelcalls，单run$.5（env RUN_BUDGET_USD只收紧）。先将 modelCalls+1、保守reservation estimatedUsd计入run并addEvent planning_started落盘，然后callModel。成功actual结算全球并将run reservation替换actual，tokens累计；失败/usage未知保留reservation，标unknown计费；计数仍消耗。所有真实调用先reserve即使planning未approval，不能调用core.recordModelUsage假装approval。plan parsePlanResponse + validatePlan；失败failed未approved，用户手动replan才尝试下一次，不静默fallback为demo。
同样review最多总4，reviewPayload(compareFinancials,compactContext),maxoutput6000，预留调用与费用先save；返回解析引用review→buildResearchReport→completeRun。模型解读错误仍收费，无法验证则paused/failed明确错误，不伪造completed；后续resume再review但上限保留。
模型响应迟到即使run被stop：每日已发请求仍settle实际费用（不能释放），run终态保持，允许仅用量补记到当前ownedrecord但不能复活/写report，CAS失败有限一次后记录每日账本真实。保守预留已记在run所以不用无限重试会计。
Tool beginTask先save后call，成功succeedTask+compactContext后save; 失败ProviderError retryable 时failTask + retryAt按retryAfterMs不早于now+1s，总3attempt，永久401403/invalid不重试。其他未预期错误不暴露，作为terminal内部异常。无自动执行第三次+不“skip”缺失。
Pause用户动作可随时清lease；elapsed 从originalstartedAt累积含暂停，runtime900000上限。闭页面无后台continuity：bounded请求已在处理可返回checkpoint，下一打开继续，文档诚实。
报告与导出仅validateReport成功；raw证据存完整D1按repository大小限制；过大失败可解释不造数据。
可注入只读engine工具/model依赖用于真正迟到/并发测试，但默认必真实实现，禁止生产fallback为stub。

## 必须测试
命令 node --experimental-strip-types --test tests/server.test.ts。授权demo完整研究全任务→completed真实constructed证据/有效引用/导出；missingnull仍显式unknown；failure暂停→resume保留计数/证据；拒绝计划零工具；预算tighten(1tool)暂停不能reset；刷新GET状态一致；跨owner/mode404/403；CSRF拒绝；memoryconfirmed缺失拒绝、添加/删除scope；请求体/符号/版本非法拒绝；真实SQLiteCAS stop迟到不增证据（注入延迟读任务，仅此test）；重复advance租约只有一个实际call；过期lease恢复不重复开始；未配live密钥不给授权调用。
不要求真实联网或读key。报告红绿命令+结果+判据、API契约/限制、未知；root执行npmtypecheck和总集成，若typecheck问题涉及你源码须修正，他人错误报告即可。

## 22:39 真实集成发现的容量修正（替代原2200值）
真实脚本 scripts/probe-review.mjs 使用既有5份真实证据和当前high思考配置，HTTP成功但status=incomplete/output为空；实际input9843/output2200，估算0.0055929USD，严格解析拒绝为正确行为。提高reviewPayload.max_output_tokens到6000并新增payload容量回归；engine的review费用预留必须根据payload真实max_output_tokens=6000计算，不能继续按2200预留。单研究$.50/总4次/全站$5不变、120秒超时不变，不自动降低reasoning。规划保持3000。此次是集成容量修正，不扩展产品边界；记录实际计費，保留失败用量，不静默假报告。默认真实调用仍最终由root验证；你不要联网或读取密钥。

最终集成参数：review max_output_tokens=12000（高推理共享该额度），实际5证据复核通过，预留按payload真实限额计算。严禁将 incomplete 部分报告视为完成。
