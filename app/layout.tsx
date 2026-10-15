import type { Metadata, Viewport } from "next";
import "./globals.css";
import Boot from "@/components/Boot";
import Rewards from "@/components/Rewards";

export const metadata: Metadata = {
  title: "日语听说练习",
  description: "精听、跟读、AI 场景对话",
  appleWebApp: { capable: true, title: "日语练习", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1b1340",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Pixel font for the RPG town; only the glyphs a page uses are downloaded. */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DotGothic16&display=swap" />
      </head>
      <body>
        {children}
        <Rewards />
        <Boot />
      </body>
    </html>
  );
}
