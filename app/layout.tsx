import type { Metadata, Viewport } from "next";
import "./globals.css";
import Boot from "@/components/Boot";
import Rewards from "@/components/Rewards";

export const metadata: Metadata = {
  title: "日语听说练习",
  description: "精听、跟读、AI 场景对话",
  appleWebApp: { capable: true, title: "日语练习", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f2ec" },
    { media: "(prefers-color-scheme: dark)", color: "#121110" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <Rewards />
        <Boot />
      </body>
    </html>
  );
}
