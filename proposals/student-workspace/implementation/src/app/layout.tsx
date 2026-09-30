import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgileCampus · 敏捷校园",
  description: "面向高校团队的 Agent 驱动轻量项目管理平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
