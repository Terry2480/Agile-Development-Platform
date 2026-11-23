import type { Metadata } from "next";
import "./globals.css";
import "./workspace-theme.css";
import "./documents.css";
import "./motion.css";
import "./motion-polish.css";
import "./workspace-motion.css";
import { ThemeProvider } from "@/components/ws/ThemeProvider";
import { SuiteLauncher } from "@/components/SuiteLauncher";
import { GuideLauncher } from "@/components/GuideLauncher";
import { PluginHost } from "@/components/PluginHost";
import { BackToTop } from "@/components/BackToTop";
import { CustomBackground } from "@/components/CustomBackground";
export const metadata: Metadata = { title: "AgileCampus 敏捷校园", description: "面向高校团队的敏捷项目协作平台" };
export default function RootLayout({ children }: LayoutProps<"/">) { return <html lang="zh-CN"><body><CustomBackground /><ThemeProvider>{children}<SuiteLauncher /><GuideLauncher /><BackToTop /><PluginHost /></ThemeProvider></body></html>; }
