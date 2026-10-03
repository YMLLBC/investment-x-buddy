import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:"投资 X Buddy · 个人 Agent 研究工作台",description:"从研究目标到可验证成果：计划审批、金融工具、证据溯源、检查点与长期记忆。",icons:{icon:"/favicon.svg",shortcut:"/favicon.svg"}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="zh-CN" className="dark"><body>{children}</body></html>}
