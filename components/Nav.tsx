"use client";

import Link from "next/link";

const TABS = [
  { key: "today", href: "/", label: "今天" },
  { key: "scenes", href: "/scenes", label: "场景" },
  { key: "me", href: "/me", label: "我" },
] as const;

export type NavKey = (typeof TABS)[number]["key"];

export default function Nav({ on }: { on: NavKey }) {
  return (
    <nav className="nav">
      {TABS.map((t) => (
        <Link key={t.key} href={t.href} className={on === t.key ? "on" : ""}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
