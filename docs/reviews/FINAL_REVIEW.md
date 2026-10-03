# 最终独立审查

日期：2026-10-03。正式目录：`D:/projects/THSwork/investment-x-buddy`。

## 结论

Task03C 两项既有 P2 修复复审通过；独立运行全部单元测试 **111/111 通过**，类型检查通过。本轮发现的 F1（过期真实会话恢复错误码不匹配）已由主代理修复，修复代码及新增回归经复审通过，详见文末追加记录。当前没有未解决的、具备可复现证据的 P0/P1/P2 审查发现。

此结论针对审查时的本地工作树，不代表生产部署、真实供应商或浏览器验收已由本审查者独立完成。

## 新发现 F1 — P2：过期真实会话的恢复错误码不匹配

位置：`components/buddy/workbench.tsx:16`。相关服务代码：`lib/buddy/server.ts:60`、`:86`、`:88`。

前端初次读取 localStorage 的 `xb-mode=live` 后请求 live bootstrap。会话已经过期或 Cookie 被删除时，服务为 bootstrap 临时创建 demo 会话，随后模式鉴权返回 `403 MODE_FORBIDDEN`。前端 catch 只检查 `AUTH_REQUIRED`；服务没有返回这个错误码。因此页面继续处于 live 模式，bootstrap 为空、生成计划按钮禁用，“重新读取状态”反复得到同样错误。此时打开登录窗口还会因 `bootstrap?.capabilities.liveAvailable ?? false` 禁用验证。用户只有自行切换 demo、等待 bootstrap，再切 live 才能恢复。

修复建议：对真实服务的 `MODE_FORBIDDEN` / `UNAUTHORIZED` 做对应恢复，清除过期模式选择并回到 demo 获取有效 bootstrap，随后提供访问码重新验证。不要把网络或配置错误一律当作会话过期。补充浏览器回归：预置 `xb-mode=live` 且无有效 Cookie，首次打开应回到可用 demo，并可以打开可提交的真实验证对话框。

独立复现命令（PowerShell；真实内存 SQLite、合成密钥、无网络）：

```powershell
@'
import assert from 'node:assert/strict';
import {sqliteD1} from './tests/support/d1.ts';
import {handleBuddy} from './lib/buddy/server.ts';
import {signSession,newSession} from './lib/buddy/auth.ts';
const {db,sqlite}=sqliteD1();
const secret='synthetic-final-review-secret-at-least-32-chars';
const now=Date.now();
const expired=await signSession(newSession('live',now-604800001),secret);
try {
  for(const mode of ['live','live','demo']) {
    const r=await handleBuddy(new Request('https://buddy.test/api/buddy/bootstrap?mode='+mode,
      {headers:{Cookie:'buddy_session='+expired}}),{DB:db,SESSION_SECRET:secret},{now:()=>now});
    const b=await r.json();
    console.log({mode,status:r.status,code:b.error?.code,sessionMode:b.session?.mode,newCookie:!!r.headers.get('set-cookie')});
    assert.equal(r.status,mode==='live'?403:200);
    if(mode==='live')assert.equal(b.error.code,'MODE_FORBIDDEN');
  }
} finally {sqlite.close();}
'@ | node --experimental-strip-types --input-type=module -
```

实际：两次 live 均 `403 / MODE_FORBIDDEN / newCookie=false`，demo 为 `200 / sessionMode=demo / newCookie=true`，进程退出 0。此命令证明后端响应契约；前端错误分支不匹配及按钮禁用由上述源码直接确认，未声称已运行此场景的浏览器测试。

## Task03C 修复复审

1. `server.ts:19` 的 parentContext 在序列化前逐码点计算 JSON 转义长度，保留 parentId/status 和闭合 JSON，整体不超过 6000。`tests/server.test.ts:242`、`:259` 覆盖九条长 memory，以及 Unicode、控制字符和转义。未再发现整体 slice 导致解析失败。
2. `engine.ts:50` 的 resumeAtCheckpoint 仅在 live、非 planning、全部工具已完成时允许进入复核恢复路径；仍验证审批、状态、永久失败、累计模型/费用/运行时长预算。`tests/server.test.ts:273` 复验三次工具额度全部消耗后模型 TIMEOUT 恢复；`:289` 复验三类预算耗尽拒绝恢复且计数、版本与证据不变。其他阶段继续使用 core.resumeRun。
3. `providers.ts:16` 使用 Workers 支持的 manual redirect；紧接着拒绝 3xx，不将携带凭证的请求转发到新地址。独立全套测试包含该回归且通过。

## 审查与验证范围

阅读实施计划、Task03C 任务/报告/FIX1、server/engine/auth/model/providers/client、API 路由、全部 buddy UI 组件及现有 e2e。重点检查作用域鉴权、CSRF、只读登记工具、模型输出严格解析、预算预留与结算、停止/暂停时迟到结果的 CAS、原字段事实与引用呈现、显式记忆确认、恢复和状态切换。核心 Harness、data/report、repository 已有其他独立复审；本轮复跑相关测试，不将未复现的猜测作为缺陷。

实际独立命令：

- `npm test`：预期所有断言通过、退出 0；实际 **111 tests / 111 pass / 0 fail / 0 skipped**，退出 **0**，约 2.33 秒。
- `npm run typecheck`：预期 tsc 无诊断、退出 0；实际 **退出 0，无诊断**。
- 上述 F1 复现命令：实际响应符合断言，退出 0，证明错误码不匹配触发条件。

本轮未重跑生产 build、Playwright 或付费接口；主代理已有对应外部验证，报告中不将转述当独立执行结果。公开 URL、GitHub 发布、最终提交包和 README 的部署状态由主代理收尾，不作为代码缺陷。未访问 `.env*`、`.dev.vars*`、`.cache` 或 `private-records`；未联网、未调用付费 API。仅新增本报告，未修改实现；D 盘正式文件存在，无本轮 C 盘缓存需要清理。

## 追加：F1 修复复审通过

2026-10-03，主代理修复后再次只读检查 `components/buddy/workbench.tsx:16` 和 `tests/e2e/workbench.spec.ts:38`。

事实：load 现在捕获实际服务返回的 `MODE_FORBIDDEN` / `UNAUTHORIZED`（兼容原 `AUTH_REQUIRED`），将 localStorage 的 `xb-mode` 保存为 demo，同时切换 demo 并关闭登录框。既有模式变更 effect 会重新获取 demo bootstrap，因此能恢复有效 session/capabilities，用户再选择真实研究时可以输入访问码。网络与配置错误仍保留正常错误反馈，不会被该分支误当鉴权错误。没有修改服务鉴权或绕过访问码。

新增回归预置 localStorage 的 live 模式，使用 Playwright 新浏览器上下文没有有效 Cookie，断言生成研究计划按钮启用、模式回到演示、重新选择真实研究后访问码输入及验证按钮可用。此回归覆盖原失败条件和实际可操作的恢复终点。

独立复核命令：`npm run typecheck` 无诊断；`node node_modules/eslint/bin/eslint.js components/buddy/workbench.tsx tests/e2e/workbench.spec.ts` 无诊断，命令进程退出 **0**。该追加没有重新运行先前已通过的 111 项单元测试，因为修复仅涉及前端鉴权错误处理和浏览器回归。

浏览器验证由主代理执行并转交：新增用例先 RED，约 20.1 秒因生成按钮 disabled 失败；修复后 GREEN，约 3.8 秒通过；另以独立 Chromium 验证无 Cookie + localStorage live 能返回可用 demo 并打开可重新验证的登录窗口。本审查者核对代码和断言，不将这两次浏览器运行表述为自己独立执行。完整 7 条 E2E 的最终结果由主代理记录。

结论：F1 关闭；未发现本次修复新增的可复现问题。保留上方原始发现及复现步骤作为审计记录。
