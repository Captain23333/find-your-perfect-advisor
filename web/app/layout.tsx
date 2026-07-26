import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Advisor Atlas · 导师匹配控制台",
  description: "本地运行、证据可追溯的 AI 导师发现与决策工作台。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
