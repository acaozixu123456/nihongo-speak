"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { todaysCards, useProgress } from "@/lib/client/progress";
import { useHydrated } from "@/lib/client/hydrated";
import { SenseiFace } from "./Sensei";

const TABS = [
  {
    href: "/",
    ja: "今日",
    icon: (
      <svg className="tab-i" viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
      </svg>
    ),
  },
  {
    href: "/listen",
    ja: "聴く",
    icon: (
      <svg className="tab-i" viewBox="0 0 24 24" aria-hidden>
        <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
        <rect x="3.5" y="13.5" width="4" height="6.5" rx="1.6" />
        <rect x="16.5" y="13.5" width="4" height="6.5" rx="1.6" />
      </svg>
    ),
  },
  {
    href: "/speak",
    ja: "話す",
    icon: (
      <svg className="tab-i" viewBox="0 0 24 24" aria-hidden>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" />
      </svg>
    ),
  },
  { href: "/me", ja: "先生", icon: null },
];

// List pages opened from a tab keep the tabs, with their tab lit. Pages where something is played,
// said or answered have their own controls at the bottom, so there the tabs give way to a back link.
const UNDER: Record<string, string> = {
  "/episodes": "/listen",
  "/scenes": "/speak",
  "/weak": "/me",
  "/bag": "/me",
  "/stats": "/me",
};

export default function TabBar() {
  const path = usePathname();
  const p = useProgress();
  const hydrated = useHydrated();
  const here = UNDER[path] ?? path;
  if (!TABS.some((t) => t.href === here)) return null;
  const due = hydrated ? todaysCards(p).length : 0;
  return (
    <nav className="tabbar">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={`tab${t.href === here ? " on" : ""}`} aria-current={t.href === path ? "page" : undefined}>
          {t.icon ?? (
            <span className="tab-face">
              <SenseiFace size={28} />
              {due > 0 && <em>{due}</em>}
            </span>
          )}
          {t.ja}
        </Link>
      ))}
    </nav>
  );
}
