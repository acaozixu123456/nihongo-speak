"use client";

import Link from "next/link";

// Two places only: 听 and 说. "我" (records, saved lines) sits behind the small button at the top.
const TABS = [
  { key: "listen", href: "/", ja: "聴く", label: "听" },
  { key: "speak", href: "/speak", ja: "話す", label: "说" },
] as const;

export type NavKey = (typeof TABS)[number]["key"] | "me";

export default function Nav({ on }: { on: NavKey }) {
  return (
    <nav className="nav">
      <div className="nav-pill">
        {TABS.map((t) => (
          <Link key={t.key} href={t.href} className={on === t.key ? "on" : ""} aria-label={t.label}>
            <b>{t.ja}</b>
          </Link>
        ))}
      </div>
    </nav>
  );
}

// Page head shared by 听 and 说: today's date on the left, the way to "我" on the right.
export function Top({ note }: { note?: string }) {
  return (
    <div className="top">
      <span>{note}</span>
      <Link href="/me" className="top-me" aria-label="我的记录">
        我
      </Link>
    </div>
  );
}
