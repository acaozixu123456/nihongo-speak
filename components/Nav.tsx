"use client";

import Link from "next/link";
import { useMemo } from "react";
import { dayKey, useProgress } from "@/lib/client/progress";
import { useHydrated } from "@/lib/client/hydrated";
import { recap } from "@/lib/client/recap";

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

// Page head shared by 听 and 说: today's date on the left; 今日 (everything learned today) and "我" on the right.
export function Top({ note }: { note?: string }) {
  const p = useProgress();
  const hydrated = useHydrated();
  const n = useMemo(() => (hydrated ? recap(p, [dayKey()]).length : 0), [p, hydrated]);
  return (
    <div className="top">
      <span>{note}</span>
      <span className="top-r">
        <Link href="/today" className={`top-today ${n ? "on" : ""}`} aria-label="今天学过的">
          今日{n > 0 && <b>{n}</b>}
        </Link>
        <Link href="/me" className="top-me" aria-label="我的记录">
          我
        </Link>
      </span>
    </div>
  );
}
