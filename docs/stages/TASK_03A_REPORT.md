# 阶段3A · 金融数据、模型与研究报告
时间：2026-10-02 19:48（Asia/Shanghai）。
状态：模块实现完成，待阶段3整体独立审查与端到端验收；不代表网站交付完成。

## 范围与已验证事实
金融适配器：扶摇证券检索、行情、历史、年度利润/现金流/资产负债、估值、交易日历；iFinD公司资料、公告、新闻。注册工具只读、参数schema校验、固定来源URL、45秒超时、响应大小限制、HTTP/业务/JSONRPC错误分别检查。新闻MCP实际嵌套业务code=1成功，data形状存在差异，原始响应保留，不伪造统一数据时点。
归一化：原字段路径、SHA256、数据时点与获取时间、单位/年度累计口径；缺失不补零，zero保留，跨期无共同年度停止财务横比。合并净利润用于经营现金流/利润公式；归母净利润另列。未核实成交量单位，移除对应展示指标，保留raw。
模型：DeepSeek Responses的真实函数规划。thinking+指定函数tool_choice首次HTTP400，改用auto，仅暴露单个函数并严格校验输出名称/参数；回归与真实核验成功。首份23步计划验证后，业务收紧为20步以内，精确证券检索并保留执行重试空间；更新后实际18步，input1859/output2948 tokens，模型估算0.0040953美元。两个成功规划估算累计0.0081948美元；接口HTTP400是否计费未知，不能由本地估算当作账单。
报告：代码提取精确字段事实，代码计算现金流/合并净利润，模型只能返回推断和未知且引用现有证据。演示完整使用实际Harness状态转换，全部数据标为构造，无外部API请求。

## 真实工具验证
scripts/verify-live.mjs初轮证券检索/利润/现金流/估值/公司资料及工具发现全部成功。
扩充轮：行情、历史、利润、资产负债、现金流、估值、日历、公司资料、公告、新闻全部成功；证券检索一次NETWORK瞬态失败，脚本退出1，未掩盖。此前两次证券检索成功。生产执行须保存检查点并按最多3总尝试处理，不能声称接口永久可靠。
原始响应与schema在忽略的 .cache/live-probes，正式公开包不包含私密数据缓存。docs/DATA_AND_INTERFACES.md保留可核验关键字段与来源。

## 测试与判断标准
- tests/data.test.ts 6项：零/缺失、币种/身份、陈旧、百分比、共同财报期与非正分母。
- tests/providers.test.ts 6项：鉴权终止、限流/重试信息、响应大小、JSON/SSE身份、固定地址、嵌套业务错误。
- tests/model.test.ts 6项：指定函数输出、范围/schema/重复/核心数据覆盖、引用、usage费用、thinking兼容、计划20步与精确检索。
- tests/research.test.ts 3项：完整演示完成、缺失现金流不造事实、瞬态失败首尝试及恢复条件。
各模块先有预期失败（桩或未实现行为）再实现成功，失败/成功输出在执行记录中；受控完整TypeScript检查曾退出0，后续新增源码仍须重新核验。
可执行命令：node --experimental-strip-types --test tests/data.test.ts tests/providers.test.ts tests/model.test.ts tests/research.test.ts。
实际最终结果由后续全量验证记录补充；“原测试通过”不能替代独立审查。

## 未完成与边界
数据库/会话/租约、每日预算原子预留、Web API、完整UI、正式部署、真实完整研究、最终审查与压缩包尚待完成。非原始披露数据的二次交叉核验仍未知；不把供应商返回值包装成确定投资结论。原始模型推理不保存或显示，只显示执行摘要及用量。

## 2026-10-02 · Task03A 首轮审查修复补充

依据仅为 `docs/tasks/TASK_03A_DATA_MODEL.md` 和首轮限定审查的 5 项阻断。此次仅修改 `lib/buddy/{data,model,research}.ts`、对应 3 个测试文件，并追加本报告；不修改 providers/demo/types/core/storage/UI/全局文档。未联网、未读取 `.env` 或密钥、未提交；正式文件均在 D 盘，未创建 C 盘任务缓存。以下是修复验证事实，仍须独立复审，不能据此宣称所有跨任务集成已验收。

- 不安全金额：数值限定为有限数且绝对值不超过 `Number.MAX_SAFE_INTEGER`；数字字符串还校验格式归一化后与转换结果的十进制表示一致，拒绝静默舍入或下溢。异常字段归一化为 null、整份证据标 conflict，raw、键序、原 fieldPath 与原始对象 SHA256 保留。现金流/利润与净利率再次检查有限性，溢出返回 null，并通过 issue → unknown 披露，不生成 Infinity/NaN 推断。
- 年度口径：A 股 FY 按 UTC+08:00 的境内日历校验年末 12 月 31 日与 fiscal_year 一致；UTC asOf 仍保留原时间。错配与非年末标 conflict，停止参与比较；正常 `2025-12-31T00:00:00+08:00` 不会因 UTC 日期是 12 月 30 日而误判。
- 历史覆盖：保留全部实际返回行，按不同、口径合法且有安全数值的年度计数；重复 FY 不重复计数，不安全行/全缺失行不计入有效覆盖。scope 记录实际覆盖，少于 3 年写入 summary 和报告 limitations。合法单年事实仍可 valid、可参与单期横比；演示准确披露仅 1 年构造历史。
- 共同年度：优先选择全部公司收入、合并净利润、CFO 均可用的最近共同年度。最新共同收入年度不完整而存在完整旧期时，issue 明确缺失公司、字段、最新年度和回退年度。所有共同年度均不完整时，保留最近共同收入年度和 null/unknown；净利非正仍不计算现金转换比，演示 missing 不补零。
- 模型参数：发送和解析使用同一份函数参数 schema；完整递归检查对象、数组、必需字段、枚举、条目数量与 additionalProperties，规划顶层/任务、解读顶层/claim 的 extra 均拒绝。原有单函数/completed/证券范围/实际引用/核心工具覆盖校验保留。

### 可执行命令、预期行为与实际结果

工作目录：`D:\projects\THSwork\investment-x-buddy`；Node `v24.18.1`。

```powershell
node --experimental-strip-types --test tests/data.test.ts tests/providers.test.ts tests/model.test.ts tests/research.test.ts
```

预期：原 21 项保持通过，新增回归覆盖上述 5 项，以及缺失保护和安全年度覆盖边界；全部测试退出 0、fail=0 为成功标准。首次仅追加 13 项回归、未修源码时，实际 34 项中 pass=22/fail=12，退出 1；12 项均因目标缺陷触发预期断言失败，另 1 项确认既有“全部共同期不完整时保留最近期/null”行为。修复后另补“不安全行不计入有效覆盖”回归，先单独运行下列命令，实际 pass=0/fail=1、退出 1（错误地统计为 2/3）；修复覆盖计数后，最终全量模块结果 **35/35 通过，fail=0，退出 0**。现有 21 项未删除或改弱；新增 14 项，其中 data 8 项、model 4 项、research 2 项。

```powershell
node --experimental-strip-types --test --test-name-pattern="annual coverage excludes" tests/data.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false --strict --skipLibCheck --target ES2017 --lib DOM,DOM.Iterable,ESNext --module ESNext --moduleResolution bundler --allowImportingTsExtensions --esModuleInterop --types node lib/buddy/data.ts lib/buddy/model.ts lib/buddy/research.ts tests/data.test.ts tests/model.test.ts tests/research.test.ts
git diff --check -- lib/buddy/data.ts lib/buddy/model.ts lib/buddy/research.ts tests/data.test.ts tests/model.test.ts tests/research.test.ts docs/stages/TASK_03A_REPORT.md
```

预期：最终年度覆盖回归通过；限定文件及其导入依赖的严格 TypeScript 校验无错误、退出 0；diff 检查无空白错误、退出 0。实际：最终全量测试包含该回归并通过；严格 TypeScript 无诊断且退出 0；diff 检查退出 0（Git 仅提示工作区 LF 后续会转为 CRLF）。未用此限定类型检查替代整站验收。

复用 `docs/reviews/TASK_03A_REVIEW.md` 的两段 PowerShell 离线探针，实际均退出 0，修复后的输出为：`fiscalMismatch conflict undefined null`；`oneYear valid 1` 且 summary 明确“仅覆盖1个不同有效年度，历史覆盖不足3年度要求”；`unsafeNumber conflict null null undefined`（unsafe 不进入计算或 inference）；`planExtra REJECTED`、`reviewExtra REJECTED`。第二段 4 份证据仍为 valid，选用 `2024-FY`，两家公司 CFO=30、现金转换比=1.5、净利率=20，并同时披露最新共同收入年度 `2025-FY` 的两家公司 CFO 缺失与旧期回退。第二段使用原审查时点 `2026-04-02`，使 2024 年现金流仍在既有 550 天有效期内；不会放宽陈旧证据边界来满足回退测试。
