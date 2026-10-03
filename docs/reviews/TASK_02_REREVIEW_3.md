# TASK 02 · 修正复审第 3 轮

- 规格符合性（spec compliance）：**通过（本轮限定安全问题）**。上轮同句历史名词豁免后续交易动作问题已关闭；没有发现该问题的安全绕过残留。
- 子任务质量（task quality）：**不通过**，逐词扫描新引入普通金融说明误拒绝，需修正 P2 后复审。
- 范围：TASK_02_FIX3_PACKAGE.md（BASE 964c5025fa62dd5985e24e5a37dd8736a788dca9，HEAD f1886f4a3efdb677a7548120fc484004ca04dca8），仅同句混合动作豁免、历史名词允许基线和此次修改直接引入的行为。未扩展到 providers/model/UI；未读密钥、联网或修改实现。该规格通过不表示整体服务器或上游集成已通过。

## 验证事实

1. 原三条“历史说明 + purchase/short 指令”独立断言全部通过：违规混合句已拒绝。新增 therefore/please、and/we advise、liquidate 等命令，以及标题、摘要、限制、问题、推断五类报告文字位置的拒绝测试全部通过。
2. Short interest、Purchase price、Short positions、Purchase costs 的历史陈述及同句多个合法历史短语仍接受。扫描每个动作词，名词例外仅对应局部 token，不再豁免同句后续动作。
3. 原数字/单位、审批停止、恢复累计预算、重试、压缩/raw、证据质量与路径、导出脱敏测试保持通过。说明这些既有断言未回归，不作未测集成的推断。

本轮实际命令：`node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`，35/35 通过、退出码 0。复用上轮独立探针并加下述普通说明断言，`$probe | node --experimental-strip-types --input-type=module`：9 项，8 通过、1 失败，退出码 1。

## P2 · 逐词扫描把 short-term debt 当成做空指令

位置：lib/buddy/report.ts:93–98、101。

最小输入：保持上轮探针的合法报告和合法证据，仅将 summary（或其他文字字段）设置成 “The company has short-term debt.”，中文为“该公司有短期债务”。当前 validateReport 抛出“报告无效：预测、回报保证或交易指令”。这句话没有建议动作，仅说明债务期限。

确认是新增回归：本轮在内存中读取 BASE 提交的 report.ts，用 Node 本地 stripTypeScriptTypes 转换后执行同一输入，旧版 ACCEPTED、当前 REJECTED；未写入或修改源文件。历史 purchase price 对照样本在两版均接受。

原因：新增全词扫描把 short-term 中的 short 识别为动作；局部名词例外只覆盖 interest/positions/exposure/volume，最后将这个复合形容词当作交易指令。该校验影响所有报告文字字段，并可阻断合法研究报告完成/导出。

必要修正：区分明确交易动词与普通期限形容词，允许短期债务等正常陈述；保持逐个动作独立检查，不能恢复整句豁免。至少补充 short-term debt 的接受基线及 Short AAPL immediately 的拒绝对照，并保持当前混合句、历史名词和各文字字段测试通过。此处不要求放宽不明确的交易建议，也不要求只对单句做白名单。

## 必要复现与完成标准

沿用 TASK_02_REREVIEW_2.md 的 8 条 $probe 组合（共同样本位于 TASK_02_REREVIEW_1.md），仅追加：

```powershell
$probe += @'

test('accept descriptive short-term debt',()=>{
 const r=report(); r.summary='The company has short-term debt.';
 assert.doesNotThrow(()=>validateReport(r,[e]));
});
'@
$probe | node --experimental-strip-types --input-type=module
```

本轮新增断言失败，错误为“出现了不应发生的异常”；其余 8 条通过。完成标准：限定原 35 项继续通过，此组合 9/9 通过且退出码 0；短期债务陈述接受，明确做空指令及混合句命令仍拒绝。

目前没有新增确认的安全放行问题；未通过原因是具体新增可用性回归。正式报告存放 D 盘，未生成需要清理的 C 盘缓存。

