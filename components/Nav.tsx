"use client";

import Link from "next/link";
import { dueCards, useProgress } from "@/lib/client/progress";

const ICONS = {
  today: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  scenes: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M3 9h18M8 4v5" />
    </>
  ),
  review: (
    <>
      <rect x="6" y="3" width="14" height="18" rx="3" />
      <path d="M3 7v12a2 2 0 0 0 2 2" />
    </>
  ),
  stats: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
};

const TABS = [
  { key: "today", href: "/", label: "今天" },
  { key: "scenes", href: "/scenes", label: "场景" },
  { key: "review", href: "/review", label: "复习" },
  { key: "stats", href: "/stats", label: "成长" },
] as const;

export type NavKey = (typeof TABS)[number]["key"];

export default function Nav({ on }: { on: NavKey }) {
  const due = dueCards(useProgress()).length;
  return (
    <nav className="nav">
      {TABS.map((t) => (
        <Link key={t.key} href={t.href} className={on === t.key ? "on" : ""}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {ICONS[t.key]}
          </svg>
          {t.label}
          {t.key === "review" && due > 0 && <span className="badge">{due}</span>}
        </Link>
      ))}
    </nav>
  );
}
