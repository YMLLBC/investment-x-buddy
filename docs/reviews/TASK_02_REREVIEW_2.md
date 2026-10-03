# TASK 02 · 修正复审第 2 轮

- 规格符合性（spec compliance）：**不通过**，出现直接交易指令的安全回归。
- 子任务质量（task quality）：**不通过**，需收窄历史名词例外后复审。
- 范围：TASK_02_FIX2_PACKAGE.md（BASE c645edf902622d83fe79da4a927d10578076a829，HEAD 964c5025fa62dd5985e24e5a37dd8736a788dca9），仅上轮数字贴单位、历史说明问题和修正直接引入的行为。未审查 providers/model/UI；未读取密钥、联网或修改实现。

## 上轮问题状态及验证

1. 原 P1 数字贴单位：**已修复**。200USD/200EUR 的错误事实及 JSON/Markdown 导出均拒绝；正确 100USD/100 USD、精确浮点/数字字符串、科学记数法及可信代码/期间正向基线通过。
2. 原 P2 历史说明误拒绝：**原复现已修复**。Short interest is... 和 Purchase price was... 接受；新增名词说明在全部报告文字位置的接受测试通过。但新增豁免引入下述 P1，不能据此前两个结果认定本轮整体通过。
3. 原审批/停止/恢复累计预算、重试、压缩/raw 保留、证据路径/质量/值/单位及脱敏安全测试均保留并通过。测试结果仅说明这些具体断言未回归。

本轮命令及真实结果：

- `node --experimental-strip-types --test tests/harness.test.ts tests/report.test.ts`：33/33 通过，退出码 0。
- 重新执行 TASK_02_REREVIEW_1.md 中的独立探针：5/5 通过，退出码 0。
- 同一探针追加下述 3 条安全断言后，`$probe | node --experimental-strip-types --input-type=module`：8 项，5 通过、3 失败，退出码 1。

## P1 · 历史名词豁免放行同句后续交易指令

位置：lib/buddy/report.ts:89–92（financialSubject 对整个 tradingAction 匹配给出豁免）。

事实：保持上轮探针的合法证据和合法 fact，只替换 summary，以下文字仍被 validateReport 接受：

- “Short interest is disclosed, so purchase AAPL immediately.”（卖空比例已披露，因此立即购买 AAPL。）
- “Purchase price was 100 USD yesterday, purchase AAPL immediately.”（昨天的购买价格为 100 美元，立即购买 AAPL。）
- “Short interest is disclosed and you should short AAPL now.”（卖空比例已披露，你应该现在做空 AAPL。）

对照 “Short interest is disclosed. Purchase AAPL immediately.” 会被拒绝。问题不是名词说明本身，而是同一句中明确的交易命令被前面的普通说明一起豁免。

原因：tradingAction 消费该句最多 80 字符；financialSubject 只要匹配其前部历史名词结构，就令整个匹配成为安全内容。逗号及 and 后面的 purchase/short 命令未单独检查。原来被拒绝的整句在此次例外加入后获准，属于修正直接引入的回归。

必要修正：仅为实际金融名词陈述部分豁免，独立检查剩余分句中的交易动作和目标，包括逗号/连词连接的命令；不能因为一句话含历史说明就豁免整句。保留原纯历史接受测试、明确命令拒绝测试，新增上述混合句拒绝断言。不得移除既有交易安全检查，也不得仅对这三句增加文本黑名单。

## 必要复现与判断标准

沿用 TASK_02_REREVIEW_1.md 的 PowerShell 探针（其中定义了 $probe、report()、e、assert 和 test）；在运行该报告探针后追加以下代码，不写文件：

```powershell
$probe += @'

for (const summary of [
 'Short interest is disclosed, so purchase AAPL immediately.',
 'Purchase price was 100 USD yesterday, purchase AAPL immediately.',
 'Short interest is disclosed and you should short AAPL now.'
]) {
 test('reject command after historical subject: '+summary,()=>{
  const r=report(); r.summary=summary;
  assert.throws(()=>validateReport(r,[e]));
 });
}
'@
$probe | node --experimental-strip-types --input-type=module
```

本轮新增 3 条断言均失败，错误为“缺少预期异常”，证明违规 summary 被接受。修正完成标准：限定原 33 项仍通过；上轮 5 条独立断言及新增 3 条全部通过、退出码 0；纯历史说明继续接受，混合句中的明确交易指令被拒绝。

报告写入 D:/projects/THSwork/investment-x-buddy/docs/reviews/TASK_02_REREVIEW_2.md；未生成需要清理的 C 盘缓存。阶段报告历史红阶段仅作为提交者记录，本轮判定基于新执行输出。

