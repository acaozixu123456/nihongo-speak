"use client";

import Link from "next/link";
import { dueCards, quests, useProgress } from "@/lib/client/progress";

const TABS = [
  { key: "town", href: "/", label: "小镇", icon: "🗺️" },
  { key: "quests", href: "/quests", label: "任务", icon: "📜" },
  { key: "bag", href: "/bag", label: "背包", icon: "🎒" },
  { key: "stats", href: "/stats", label: "成长", icon: "🏆" },
] as const;

export type NavKey = (typeof TABS)[number]["key"];

export default function Nav({ on }: { on: NavKey }) {
  const p = useProgress();
  const badges: Partial<Record<NavKey, number>> = {
    quests: quests(p).filter((q) => !q.done).length,
    bag: dueCards(p).length,
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
