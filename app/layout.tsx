import type { Metadata } from "next";
import "./globals.css";
import "./workspace-theme.css";
import "./motion.css";
import "./motion-polish.css";
import "./workspace-motion.css";
import { ThemeProvider } from "@/components/ws/ThemeProvider";
import { SuiteLauncher } from "@/components/SuiteLauncher";
import { PluginHost } from "@/components/PluginHost";
export const metadata: Metadata = { title: "AgileCampus 敏捷校园", description: "面向高校团队的敏捷项目协作平台" };
export default function RootLayout({ children }: LayoutProps<"/">) { return <html lang="zh-CN"><body><ThemeProvider>{children}<SuiteLauncher /><PluginHost /></ThemeProvider></body></html>; }
