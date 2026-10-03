# 关键数据与接口

已验证：DeepSeek /models HTTP200；扶摇 /api/meta/tickers/search?q=600519.SH&asset_type=a-share&limit=1 HTTP200/code0；iFinD综合/A股/新闻tools/list HTTP200（9/10/3）。不以工具列表代替真实取数。

## 来源
https://fuyao.aicubes.cn/docs/
https://api-docs.deepseek.com/guides/responses_api
https://mcp.51ifind.com/

iFinD基础地址：https://api-mcp.51ifind.com:8643/ds-mcp-servers/
A股：hexin-ifind-ds-stock-mcp；新闻：hexin-ifind-ds-news-mcp。

## 证据规则
原始响应与报告分开保存：provider/来源URL/获取时间/数据时点/单位/口径/原字段路径/SHA256。null不补零，零不当缺失；财报累计值不冒充季度，报告期不混比。代码保留市场后缀，Asia/Shanghai时区，响应日期不冒充行情/报告日期；复权未知时明确原始价格。HTTP与业务code都检查，缺失/过期/冲突/失败分别展示。事实由原字段与确定计算支持，推断引用证据，未知注明不足。

## 安全
工具和模型文本视为不可信；只执行注册且schema校验的只读工具，禁止任意URL/脚本/文件/交易调用。限制输入与响应长度。真实数据按会话隔离。公开示例为构造数据，Authorization不进入日志。

变量：DEEPSEEK_API_KEY、DEEPSEEK_BASE_URL、DEEPSEEK_MODEL、FUYAO_API_KEY、IFIND_API_KEY、IFIND_MCP_BASE_URL、RESEARCH_ACCESS_CODE。真实值仅忽略文件和部署secrets。

## 阶段3真实取数结果（2026-10-02）
扶摇实际财务字段与官方示例相符，返回最近3期年度累计数据（2025/2024/2023 FY），币种CNY、金额元。真实样本已核验营业收入、合并净利润与经营现金流字段存在且可解析；具体供应商数值仅保留在本地私密记录，公开仓库和演示不分发真实供应商样本。数据尚未与原始披露做二次交叉核验，不构成投资判断。原始路径 data.item.0.<字段>、period_end_ms以及SHA256已保留。
iFinD get_stock_info真实成功：MCP result.content.text 内嵌JSON，业务code为1且msg=success，data.answer含公司资料表格。新闻/公告schema实际要求 query/size/time_start/time_end；工作台进一步限制size<=5和日期格式yyyy-MM-dd。
DeepSeek /responses实际错误：思考模式不接受指定函数 tool_choice 对象；改用auto，仅提供单个规划/解读函数，并在应用层严格要求指定函数及参数。官方参考https://api-docs.deepseek.com/guides/responses_api，最终支持状态以真实调用结果为准。
