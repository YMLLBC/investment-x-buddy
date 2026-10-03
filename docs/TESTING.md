# 测试说明
当前成功与失败记录以 VALIDATION.md 为准；此文件解释覆盖范围和判定规则，不把尚未执行的检查写为通过。
## 运行
- `node --experimental-strip-types --test tests/*.test.ts`：内核、字段归一化、模型结构解析、报告校验、鉴权、真实SQLite存储及服务编排。任何断言失败则退出非0。
- `node node_modules/typescript/bin/tsc --noEmit`：全量类型检查，无诊断退出0才通过。
- `node node_modules/eslint/bin/eslint.js . --ignore-pattern dist --ignore-pattern .next`：静态检查，不能以隐藏新产品代码规则来消除缺陷。
- `node D:/softwaretwo/node/node_modules/npm/bin/npm-cli.js run build`：本执行环境规范npm入口；普通环境用npm run build。必须五环境构建完成并退出0。
- `node node_modules/playwright/cli.js test`：启动真实独立Chromium，访问已运行本地产品，所有6条UI用例成功才通过。浏览器和结果均D盘，截图/trace排除提交包。
## 必要覆盖
内核：新目标待审批、拒绝、顺序执行、失败最多3尝试、暂停恢复不重置预算、停止迟到、幂等、压缩绑定目标/记忆/IDs、报告完整验证。安全：schema拒未知/任意参数，事实绑定原字段/value/unit，收益承诺/确定价格/直接交易指令拒绝，注入数据不提高权限，密钥与隐藏推理脱敏。
字段：null与0，单位/证券/币种/财年/年末时区，过期、缺失、冲突，安全数值、派生溢出、3年度覆盖，共同完整期和明确回退。
数据库：真实SQLite执行同SQL，owner+mode隔离，版本CAS与唯一租约，停止清lease、迟到不写raw，原raw JSON键序和hash回读一致，metadata键序幂等；每日原子预算、未知费用保留、乱序限流和行大小保护。
服务：审批与HTTP会话/CSRF、持久恢复、完整demo报告/导出、缺失/瞬态失败、预算、停止并发、显式memory确认。默认不联网；迟到测试注入只读延迟依赖用于调度验证，不作为真实供应商验证。
UI：完整报告与图表、证据SHA256、JSON下载、记忆确认/删除/刷新、缺失unknown、失败恢复、拒绝/预算/停止、手机无横向溢出及键盘焦点、无效访问码反馈。
## 真实验收
由用户授权的私密配置运行真实工具、规划、解读及完整研究脚本。成功需真实规划被schema接受、金融工具返回明确证据、真实解读及数值/引用校验通过、D1完成状态读回、导出可解析。不得用演示或mock代替；HTTP200不等于完整成果，status=incomplete必须拒绝。失败及修正、费用、时间、调用次数记录VALIDATION；原始响应仅本地私密缓存，真实供应商数值不公开重分发。
## 独立审查
Harness四轮、持久化两轮、数据模型一轮修正均留有初审/复审报告与diff。跨任务未验证项交给服务/e2e/最终审查，不能以模块通过替代整站验收。最终检查源码、客户端构建和提交ZIP的真实密钥值，零发现才可发布。
