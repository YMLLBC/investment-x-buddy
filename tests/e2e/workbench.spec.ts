import {test,expect,type Page} from "@playwright/test";
import {readFile} from "node:fs/promises";
async function start(page:Page,scenario?:string,budget?:string){
 await page.goto("/");await expect(page.getByRole("button",{name:"生成研究计划"})).toBeEnabled();
 if(scenario||budget){await page.getByText("研究边界与演示场景",{exact:true}).click();if(budget)await page.getByRole("spinbutton",{name:/工具调用预算/}).fill(budget);if(scenario){await page.getByRole("combobox",{name:"演示场景"}).click();await page.getByRole("option",{name:scenario}).click()}}
 await page.getByRole("button",{name:"生成研究计划"}).click();await expect(page.getByRole("button",{name:"确认计划并开始"})).toBeVisible();await page.getByRole("button",{name:"确认计划并开始"}).click();
}
test("完整主链路：财务比较、原始证据哈希、导出、记忆与刷新",async({page})=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await start(page);await expect(page.getByText("已完成",{exact:true}).first()).toBeVisible({timeout:60000});
 await expect(page.locator(".report-panel")).toContainText("构造");
 await page.getByRole("tab",{name:"数据对比"}).click();await expect(page.getByRole("cell",{name:"贵州茅台"})).toBeVisible();await expect(page.getByText("2025-FY",{exact:true}).first()).toBeVisible();
 await page.screenshot({path:"test-results/desktop-overview.png",fullPage:true});
 await page.getByRole("tab",{name:"研究成果"}).click();await page.locator(".citation-list button").first().click();await expect(page.getByRole("heading",{name:"证据核验"})).toBeVisible();await page.getByRole("button",{name:"重新计算哈希"}).click();await expect(page.getByRole("button",{name:"哈希一致"})).toBeVisible();await page.keyboard.press("Escape");
 await page.getByRole("button",{name:"导出成果"}).click();const downloadEvent=page.waitForEvent("download");await page.getByRole("menuitem",{name:"JSON · 完整可复核数据"}).click();const download=await downloadEvent;const filename=await download.path();expect(filename).toBeTruthy();const exported=JSON.parse(await readFile(filename!,"utf8"));expect(JSON.stringify(exported)).toContain("构造");expect(JSON.stringify(exported)).not.toMatch(/sk-[A-Za-z0-9]|Authorization|ownerId|buddy_session/);
 await page.getByRole("button",{name:"存入长期记忆"}).click();await page.getByLabel("我已检查内容，并确认写入长期状态").check();await page.getByRole("button",{name:"确认保存"}).click();await page.getByRole("button",{name:/^长期记忆/}).click();await expect(page.locator(".memory-row")).toHaveCount(1);
 await page.reload();await page.getByRole("button",{name:/^长期记忆/}).click();await expect(page.locator(".memory-row")).toHaveCount(1);await page.getByRole("button",{name:"删除记忆"}).click();await page.getByRole("button",{name:"确认删除",exact:true}).click();await expect(page.locator(".memory-row")).toHaveCount(0);
 expect(errors).toEqual([]);
});
test("缺失场景：保留null与未知，不显示伪造正常现金流",async({page})=>{
 await start(page,"现金流缺失 · 保留未知");await expect(page.getByText("已完成",{exact:true}).first()).toBeVisible({timeout:60000});await expect(page.locator(".claim-unknown")).toContainText("000568.SZ");await page.getByRole("tab",{name:"数据对比"}).click();const row=page.getByRole("row").filter({hasText:"泸州老窖"});await expect(row).toContainText("缺失");await expect(row).toContainText("不可比较");
});
test("接口失败：暂停，刷新恢复后重试，已完成步骤不重复",async({page})=>{
 await start(page,"接口失败 · 暂停后恢复");await expect(page.getByText("暂时性接口失败，可重试",{exact:true})).toBeVisible({timeout:30000});await expect(page.locator(".task-completed")).toHaveCount(3);await page.reload();await expect(page.getByRole("button",{name:"恢复执行"})).toBeEnabled();await page.getByRole("button",{name:"恢复执行"}).click();await expect(page.getByText("已完成",{exact:true}).first()).toBeVisible({timeout:60000});await page.getByRole("tab",{name:/执行计划/}).click();await expect(page.locator(".task-completed")).toHaveCount(18);await expect(page.locator(".task-text").filter({hasText:"600519.SH · 年度利润表"})).toContainText("第 2 次尝试");
});
test("拒绝与预算边界：工具费用不被恢复重置",async({page})=>{
 await page.goto("/");await expect(page.getByRole("button",{name:"生成研究计划"})).toBeEnabled();await page.getByRole("button",{name:"生成研究计划"}).click();await page.getByRole("button",{name:"拒绝计划"}).click();await expect(page.getByText("研究已停止",{exact:true})).toBeVisible();await expect(page.locator(".task-completed")).toHaveCount(0);
 await page.getByRole("button",{name:"新建研究",exact:true}).click();await page.getByText("研究边界与演示场景",{exact:true}).click();await page.getByRole("spinbutton",{name:/工具调用预算/}).fill("1");await page.getByRole("button",{name:"生成研究计划"}).click();await page.getByRole("button",{name:"确认计划并开始"}).click();await expect(page.getByText("工具调用预算已用尽",{exact:true})).toBeVisible({timeout:30000});await page.getByRole("button",{name:"恢复执行"}).click();await expect(page.getByRole("alert")).toBeVisible();await expect(page.locator(".task-completed")).toHaveCount(1);
});
test("停止：刷新保留终态，不接收迟到证据",async({page})=>{
 await start(page);await expect(page.locator(".task-completed").first()).toBeVisible();await page.getByRole("button",{name:"停止研究",exact:true}).click();await expect(page.getByText("研究已停止",{exact:true})).toBeVisible();const before=await page.locator(".task-completed").count();await page.waitForTimeout(1600);await page.reload();await expect(page.getByText("研究已停止",{exact:true})).toBeVisible();await expect(page.locator(".task-completed")).toHaveCount(before);await expect(page.getByRole("button",{name:"恢复执行"})).toHaveCount(0);
});
test("手机布局、键盘与个人访问码失败反馈",async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto("/");await expect(page.getByRole("button",{name:"生成研究计划"})).toBeEnabled();await expect(page.getByRole("heading",{name:"把问题，变成有证据的研究。"})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:"test-results/mobile-home.png",fullPage:true});await page.getByRole("combobox",{name:"研究模式"}).click();await page.getByRole("option",{name:"真实研究 · 访问码"}).click();await expect(page.getByRole("heading",{name:"开启真实研究空间"})).toBeVisible();await page.getByLabel("个人访问码").fill("definitely-invalid-code");await page.getByRole("button",{name:"验证并进入"}).click();await expect(page.locator(".form-error")).toBeVisible();await page.keyboard.press("Escape");await expect(page.getByRole("heading",{name:"开启真实研究空间"})).toHaveCount(0);await page.getByLabel("研究目标").focus();await expect(page.getByLabel("研究目标")).toBeFocused();
});

test("过期真实会话：回退演示并允许重新登录",async({page})=>{await page.addInitScript(()=>localStorage.setItem("xb-mode","live"));await page.goto("/");await expect(page.getByRole("button",{name:"生成研究计划"})).toBeEnabled();await expect(page.getByRole("combobox",{name:"研究模式"})).toContainText("演示");await page.getByRole("combobox",{name:"研究模式"}).click();await page.getByRole("option",{name:"真实研究 · 访问码"}).click();await expect(page.getByLabel("个人访问码")).toBeEnabled();await page.getByLabel("个人访问码").fill("test-expired-session");await expect(page.getByRole("button",{name:"验证并进入"})).toBeEnabled()});
