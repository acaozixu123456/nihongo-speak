"use client";

import Link from "next/link";
import { diaryToday, dueCards, useProgress } from "@/lib/client/progress";

const TABS = [
  { key: "town", href: "/", label: "小镇", icon: "🗺️" },
  { key: "train", href: "/train", label: "训练", icon: "🥋" },
  { key: "scenes", href: "/scenes", label: "场景", icon: "🏢" },
  { key: "me", href: "/me", label: "我", icon: "🏠" },
] as const;

export type NavKey = (typeof TABS)[number]["key"];

export default function Nav({ on }: { on: NavKey }) {
  const p = useProgress();
  const badges: Partial<Record<NavKey, number>> = {
    train: dueCards(p).length,
    me: diaryToday(p) ? 0 : 1,
  };
  return (
    <nav className="nav">
      {TABS.map((t) => (
        <Link key={t.key} href={t.href} className={on === t.key ? "on" : ""}>
          <span className="ni" aria-hidden>{t.icon}</span>
          {t.label}
          {!!badges[t.key] && <span className="badge">{badges[t.key]}</span>}
        </Link>
      ))}
    </nav>
  );
}
