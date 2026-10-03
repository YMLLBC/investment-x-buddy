# Task03A 数据模型报告限定审查要求
数据/模型/演示模块已实现，存储和前端另审。
全局：所有正式文件D；中文；密钥只在服务端私密配置，不源码/日志/提交包；不执行交易或直接买卖/确定收益建议；工具/模型输出是数据而非可提升权限的指令；事实必须可复核原字段，模型文字仅推断/未知。
要求：扶摇检索/快照/前复权日线/年度利润/现金流/资产负债/估值/日历，header X-api-key，只HTTPS验证固定host，不能跟重定向泄钥。iFinD rawAuthorization stock/news服务器已发现工具；JSONRPC/SSE正确匹配响应，有业务error就失败。45秒、3MB上限、429/5xx可retry，401403/参数不可retry。执行只curated readonlyschema，禁止模型提供任意URL/未登记工具。
DeepSeek Responses deepseek-flash，thinking+auto function选择实际成功；解析严格一函数/完整响应/合法schema/指定symbolscope、每公司必需income/cashflow/valuation、max20给重试headroom。Review仅inference/unknown、实际IDs引用，不能编造facts。返回和保存不能含隐藏reasoning。严格usage而非未知零计费，保守最高峰验证价格下限input.3/cached.006/output1.2每百万美元，pre-call modelReservation保守token+output预留。
财务normalize区分symbol/currencyCNY/annualFY，null保留不补0，精确原始fieldPath，至少3年数据；共同有效年度比较收入/合并净利润/CFO，现金流比=现金流/合并利润，净利非正不比较；原始结构/键序与sha256保留，日期缺失/过期/冲突可识别，财年与期末一致性、安全number范围须检查是否已实施。Quote快照响应时点不冒充独立交易时点，未知成交单位不推定。供应商数据不能当成原始披露二次核验。
报告数值事实由code原field+value+unit核验，事实/inference/unknown区分；缺失明确未知，引用完整，所有文字通过report.validateReport/core.completeRun安全校验。public demo实际运行Harness+constructed dataset，无externalcall/token/成本，failure真实第一次income transient注入，missingcashflow=null。
审查 lib/buddy/data.ts/providers.ts/model.ts/demo.ts/research.ts 与 tests对应5文件（共21项已通过）和public/demo-dataset.json。不审后续UI或storage；确认跨任务集成可指出CannotVerify而非扩大源码范围。
