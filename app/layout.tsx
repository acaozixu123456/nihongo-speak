import type { Metadata, Viewport } from "next";
import "./globals.css";
import Boot from "@/components/Boot";
import RouteBar from "@/components/RouteBar";
import TabBar from "@/components/TabBar";
import AskAi from "@/components/AskAi";
import AudioWait from "@/components/AudioWait";

export const metadata: Metadata = {
  title: "日语听说练习",
  description: "精听、跟读、AI 场景对话",
  appleWebApp: { capable: true, title: "日语练习", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f1ea",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Google serves these in small unicode-range slices, so a page only downloads the glyphs it uses. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@500;600&family=Shippori+Mincho:wght@500;600;700&display=swap"
        />
      </head>
      <body>
        {children}
        <RouteBar />
        <TabBar />
        <AskAi />
        <AudioWait />
        <Boot />
      </body>
    </html>
  );
}
